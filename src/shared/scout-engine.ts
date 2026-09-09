import type { FaceitInfo, ScoutResult, ScoutSignal, SteamInfo } from './types'
import { scoreToLevel } from './types'

/**
 * Suspicion Engine.
 *
 * Deterministic, explainable, fixed-threshold scoring. It measures *statistical
 * anomaly*, never "cheating". Every point is attached to a signal with a human
 * readable explanation and a source (faceit / account).
 *
 * The overall score is the FACEIT sub-score (max 100):
 *
 *   KD anomaly            0–25
 *   ADR anomaly           0–20
 *   HS% anomaly           0–15
 *   Win-rate anomaly      0–10
 *   Performance jump      0–10
 *   Account age*          0–10
 *   Low match count*      0–10
 *
 * (*) context signals: only count when the performance points reach
 * CONTEXT_GATE. A new account with average stats scores 0.
 *
 * Rules: thresholds ramp linearly; small samples halve performance points;
 * missing data never adds points; existing bans are facts, not score.
 */

export const ENGINE_VERSION = 3

export const THRESHOLDS = {
  faceit: {
    kd: { from: 1.25, to: 2.0, max: 25 },
    adr: { from: 85, to: 120, max: 20 },
    hs: { from: 55, to: 75, max: 15 },
    winRate: { from: 58, to: 75, max: 10 },
    jump: {
      kdRatio: { from: 1.15, to: 1.5, max: 6 },
      adrRatio: { from: 1.12, to: 1.4, max: 4 },
      minLifetimeMatches: 100,
      minRecentMatches: 10
    }
  },
  accountAgeMonths: [
    { below: 3, points: 10 },
    { below: 6, points: 8 },
    { below: 12, points: 5 },
    { below: 24, points: 2 }
  ],
  matchCount: [
    { below: 50, points: 10 },
    { below: 100, points: 7 },
    { below: 200, points: 4 }
  ],
  minReliableMatches: 10,
  contextGate: 8
} as const

export interface ScoutInput {
  steam?: SteamInfo
  faceit?: FaceitInfo
}

/** Linear ramp; works in both directions (from > to means "lower is worse"). */
function ramp(value: number, from: number, to: number, max: number): number {
  if (from < to) {
    if (value <= from) return 0
    if (value >= to) return max
    return ((value - from) / (to - from)) * max
  }
  if (value >= from) return 0
  if (value <= to) return max
  return ((from - value) / (from - to)) * max
}

function monthsBetween(fromIso: string, now: Date): number | undefined {
  const t = Date.parse(fromIso)
  if (Number.isNaN(t)) return undefined
  return Math.max(0, now.getTime() - t) / (1000 * 60 * 60 * 24 * 30.4375)
}

const fmt = (n: number, digits = 2): string => (Number.isFinite(n) ? n.toFixed(digits) : '?')

interface AccountContext {
  ageMonths?: number
  ageSource?: 'steam' | 'faceit'
  ageNote?: string
}

function accountContext(s: SteamInfo | undefined, f: FaceitInfo | undefined, now: Date): AccountContext {
  if (s?.accountCreatedAt) return { ageMonths: monthsBetween(s.accountCreatedAt, now), ageSource: 'steam' }
  if (f?.activatedAt) return { ageMonths: monthsBetween(f.activatedAt, now), ageSource: 'faceit' }
  return { ageNote: s?.profilePrivate ? 'Steam profile is private: account age unknown, no points added.' : 'Account age unknown, no points added.' }
}

/** Raw account-age points (before the context gate). */
function accountAgeRaw(ctx: AccountContext): number {
  if (ctx.ageMonths === undefined) return 0
  const band = THRESHOLDS.accountAgeMonths.find((b) => ctx.ageMonths! < b.below)
  if (!band) return 0
  return ctx.ageSource === 'faceit' ? Math.round(band.points * 0.6) : band.points
}

function matchCountPoints(matches: number | undefined, allowed: boolean, signals: ScoutSignal[], notes: string[]): number {
  if (matches === undefined) return 0
  const band = THRESHOLDS.matchCount.find((b) => matches < b.below)
  if (!band) return 0
  if (!allowed) {
    notes.push(`Low faceit match count (${matches}) ignored: no performance anomaly to combine with.`)
    return 0
  }
  signals.push({
    type: 'faceit_low_match_count',
    source: 'faceit',
    label: matches < 50 ? 'Very low match count' : 'Low match count',
    points: band.points,
    explanation: `${matches} FACEIT matches with above-threshold performance stats.`
  })
  return band.points
}

export function computeScore(input: ScoutInput, now: Date = new Date()): ScoutResult {
  const signals: ScoutSignal[] = []
  const notes: string[] = []
  const { steam: s, faceit: f } = input
  const account = accountContext(s, f, now)
  if (account.ageNote) notes.push(account.ageNote)

  const components = {
    kd: 0,
    adr: 0,
    hs: 0,
    accountAge: 0,
    matchCount: 0,
    winRate: 0,
    performanceJump: 0
  }

  // =========================== FACEIT sub-score ===============================
  let faceitScore: number | undefined
  let faceitAllowed = false
  const agePts = accountAgeRaw(account)
  const hasFaceitStats = !!f && (f.kd !== undefined || f.adr !== undefined || f.headshotPercentage !== undefined)
  if (hasFaceitStats) {
    const T = THRESHOLDS.faceit
    const matches = f!.matches
    const smallSample = matches !== undefined && matches < THRESHOLDS.minReliableMatches
    const factor = smallSample ? 0.5 : 1

    if (f!.kd !== undefined) {
      components.kd = Math.round(ramp(f!.kd, T.kd.from, T.kd.to, T.kd.max) * factor)
      if (components.kd > 0)
        signals.push({
          type: 'kd_high',
          source: 'faceit',
          label: f!.kd >= 1.7 ? 'Very high KD' : 'High KD',
          points: components.kd,
          explanation: `FACEIT lifetime KD ${fmt(f!.kd)} (points start at ${T.kd.from}, max at ${T.kd.to}).`
        })
    }
    if (f!.adr !== undefined) {
      components.adr = Math.round(ramp(f!.adr, T.adr.from, T.adr.to, T.adr.max) * factor)
      if (components.adr > 0)
        signals.push({
          type: 'adr_high',
          source: 'faceit',
          label: f!.adr >= 110 ? 'Very high ADR' : 'High ADR',
          points: components.adr,
          explanation: `FACEIT lifetime ADR ${fmt(f!.adr, 0)} (points start at ${T.adr.from}, max at ${T.adr.to}).`
        })
    }
    if (f!.headshotPercentage !== undefined) {
      components.hs = Math.round(ramp(f!.headshotPercentage, T.hs.from, T.hs.to, T.hs.max) * factor)
      if (components.hs > 0)
        signals.push({
          type: 'hs_high',
          source: 'faceit',
          label: f!.headshotPercentage >= 68 ? 'Very high HS%' : 'High HS%',
          points: components.hs,
          explanation: `FACEIT headshot rate ${fmt(f!.headshotPercentage, 0)}% (points start at ${T.hs.from}%, max at ${T.hs.to}%).`
        })
    }
    if (smallSample) notes.push(`Only ${matches} FACEIT matches: performance points halved (noisy sample).`)

    const perf = components.kd + components.adr + components.hs
    const allowed = perf >= THRESHOLDS.contextGate
    faceitAllowed = allowed

    if (f!.winRate !== undefined && matches !== undefined && matches > 0) {
      let raw = ramp(f!.winRate, T.winRate.from, T.winRate.to, T.winRate.max)
      if (matches < 20) raw *= 0.5
      components.winRate = Math.round(raw)
      if (components.winRate > 0)
        signals.push({
          type: 'win_rate_high',
          source: 'faceit',
          label: 'Unusual FACEIT win rate',
          points: components.winRate,
          explanation: `Win rate ${fmt(f!.winRate, 0)}% over ${matches} matches (points start at ${T.winRate.from}%).`
        })
    }

    const r = f!.recent
    if (r && matches !== undefined && matches >= T.jump.minLifetimeMatches && r.matches >= T.jump.minRecentMatches) {
      let raw = 0
      const parts: string[] = []
      if (r.kd !== undefined && f!.kd) {
        const p = ramp(r.kd / f!.kd, T.jump.kdRatio.from, T.jump.kdRatio.to, T.jump.kdRatio.max)
        if (p > 0) parts.push(`KD ${fmt(r.kd)} vs lifetime ${fmt(f!.kd)}`)
        raw += p
      }
      if (r.adr !== undefined && f!.adr) {
        const p = ramp(r.adr / f!.adr, T.jump.adrRatio.from, T.jump.adrRatio.to, T.jump.adrRatio.max)
        if (p > 0) parts.push(`ADR ${fmt(r.adr, 0)} vs lifetime ${fmt(f!.adr, 0)}`)
        raw += p
      }
      components.performanceJump = Math.round(raw)
      if (components.performanceJump > 0)
        signals.push({
          type: 'performance_jump',
          source: 'faceit',
          label: 'Recent performance jump',
          points: components.performanceJump,
          explanation: `Last ${r.matches} FACEIT matches: ${parts.join(', ')}.`
        })
    }

    components.matchCount = matchCountPoints(matches, allowed, signals, notes)

    faceitScore = Math.min(
      100,
      components.kd + components.adr + components.hs + components.winRate + components.performanceJump + components.matchCount + (allowed ? agePts : 0)
    )
  } else if (f) notes.push('FACEIT account found but no CS2 statistics.')
  else notes.push('No FACEIT data.')

  // ---- shared account-age context signal ------------------------------------
  if (agePts > 0) {
    if (faceitAllowed) {
      components.accountAge = agePts
      signals.push({
        type: 'young_account',
        source: 'account',
        label: account.ageSource === 'steam' ? 'Young Steam account' : 'Young FACEIT account',
        points: agePts,
        explanation: `${account.ageSource === 'steam' ? 'Steam account created' : 'FACEIT account activated'} ~${fmt(account.ageMonths!, 1)} months ago, combined with FACEIT performance anomalies.`
      })
    } else if (faceitScore !== undefined) {
      notes.push(`Young account (${fmt(account.ageMonths!, 1)} months) ignored: no performance anomaly to combine with.`)
    }
  }

  const score = Math.max(0, Math.min(100, Math.round(faceitScore ?? 0)))
  signals.sort((a, b) => b.points - a.points)
  if (faceitScore === undefined) notes.push('No platform statistics: score is not meaningful.')

  return { score, level: scoreToLevel(score), signals, faceitScore, components, notes }
}
