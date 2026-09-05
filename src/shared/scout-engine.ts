import type { FaceitInfo, ScoutResult, ScoutSignal, SteamInfo, ValveInfo } from './types'
import { scoreToLevel } from './types'

/**
 * Suspicion Engine v1.1.
 *
 * Deterministic, explainable, fixed-threshold scoring. It measures *statistical
 * anomaly*, never "cheating". Every point is attached to a signal with a human
 * readable explanation and a source (faceit / valve / account).
 *
 * Two platform sub-scores are computed with the same philosophy and the overall
 * score is the higher of the two:
 *
 *   FACEIT (max 100)                  VALVE via Leetify (max 100)
 *   KD anomaly            0–25        Leetify rating         0–25
 *   ADR anomaly           0–20        Pre-aim (low)          0–20
 *   HS% anomaly           0–15        Reaction time (low)    0–15
 *   Win-rate anomaly      0–10        HS accuracy (high)     0–15
 *   Performance jump      0–10        Win-rate anomaly       0–5
 *   Account age*          0–10        Rating mismatch*       0–10
 *   Low match count*      0–10        Account age*           0–10
 *                                     Low match count*       0–10 (cap 100)
 *
 * (*) context signals: only count when the platform's performance points reach
 * CONTEXT_GATE. A new account with average stats scores 0.
 *
 * Rules: thresholds ramp linearly; small samples halve performance points;
 * missing data never adds points; existing bans are facts, not score.
 */

export const ENGINE_VERSION = 2

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
  valve: {
    /** Leetify rating in % (typical -5..+5, top players +5..+8). */
    rating: { from: 3, to: 8, max: 25 },
    /** Pre-aim in degrees: lower is better. Pros ~5-7, average ~12-15. */
    preaim: { from: 6, to: 2.5, max: 20 },
    /** Reaction time in ms: lower is better. Pros ~480-550, average ~650-750. */
    reaction: { from: 480, to: 320, max: 15 },
    /** Share of shots that hit the head. Average ~10-15, pros ~20-25. */
    hsAccuracy: { from: 22, to: 40, max: 15 },
    winRate: { from: 60, to: 80, max: 5 },
    /** Strong aim metrics with a low Premier rating. */
    mismatch: [
      { belowRating: 10000, points: 10 },
      { belowRating: 15000, points: 6 },
      { belowRating: 20000, points: 3 }
    ],
    minPerfForMismatch: 20
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
  valve?: ValveInfo
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

function matchCountPoints(matches: number | undefined, allowed: boolean, signals: ScoutSignal[], notes: string[], platform: 'faceit' | 'valve'): number {
  if (matches === undefined) return 0
  const band = THRESHOLDS.matchCount.find((b) => matches < b.below)
  if (!band) return 0
  if (!allowed) {
    notes.push(`Low ${platform} match count (${matches}) ignored: no performance anomaly to combine with.`)
    return 0
  }
  signals.push({
    type: `${platform}_low_match_count`,
    source: platform,
    label: matches < 50 ? 'Very low match count' : 'Low match count',
    points: band.points,
    explanation: `${matches} ${platform === 'faceit' ? 'FACEIT' : 'Valve'} matches with above-threshold performance stats.`
  })
  return band.points
}

export function computeScore(input: ScoutInput, now: Date = new Date()): ScoutResult {
  const signals: ScoutSignal[] = []
  const notes: string[] = []
  const { steam: s, faceit: f, valve: v } = input
  const account = accountContext(s, f, now)
  if (account.ageNote) notes.push(account.ageNote)

  const components = {
    kd: 0,
    adr: 0,
    hs: 0,
    accountAge: 0,
    matchCount: 0,
    winRate: 0,
    performanceJump: 0,
    valveRating: 0,
    valvePreaim: 0,
    valveReaction: 0,
    valveHsAccuracy: 0,
    valveRatingMismatch: 0,
    valveKd: 0
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

    components.matchCount = matchCountPoints(matches, allowed, signals, notes, 'faceit')

    faceitScore = Math.min(
      100,
      components.kd + components.adr + components.hs + components.winRate + components.performanceJump + components.matchCount + (allowed ? agePts : 0)
    )
  } else if (f) notes.push('FACEIT account found but no CS2 statistics.')
  else notes.push('No FACEIT data.')

  // =========================== VALVE sub-score ================================
  let valveScore: number | undefined
  let valveAllowed = false
  const hasValveStats =
    !!v && (v.leetifyRating !== undefined || v.preaim !== undefined || v.reactionTimeMs !== undefined || v.headshotAccuracy !== undefined || v.kd !== undefined)
  if (hasValveStats) {
    const T = THRESHOLDS.valve
    const matches = v!.totalMatches ?? v!.sampleMatches
    const smallSample = matches !== undefined && matches < THRESHOLDS.minReliableMatches
    const factor = smallSample ? 0.5 : 1

    if (v!.leetifyRating !== undefined) {
      components.valveRating = Math.round(ramp(v!.leetifyRating, T.rating.from, T.rating.to, T.rating.max) * factor)
      if (components.valveRating > 0)
        signals.push({
          type: 'valve_rating_high',
          source: 'valve',
          label: 'Very high Leetify rating',
          points: components.valveRating,
          explanation: `Leetify rating ${v!.leetifyRating >= 0 ? '+' : ''}${fmt(v!.leetifyRating)} in Valve matches (points start at +${T.rating.from}, max at +${T.rating.to}).`
        })
    }
    if (v!.preaim !== undefined && v!.preaim > 0) {
      components.valvePreaim = Math.round(ramp(v!.preaim, T.preaim.from, T.preaim.to, T.preaim.max) * factor)
      if (components.valvePreaim > 0)
        signals.push({
          type: 'valve_preaim_low',
          source: 'valve',
          label: 'Unusually precise crosshair placement',
          points: components.valvePreaim,
          explanation: `Pre-aim ${fmt(v!.preaim, 1)}° (points start below ${T.preaim.from}°, max at ${T.preaim.to}°; pros are around 5-7°).`
        })
    }
    if (v!.reactionTimeMs !== undefined && v!.reactionTimeMs > 0) {
      components.valveReaction = Math.round(ramp(v!.reactionTimeMs, T.reaction.from, T.reaction.to, T.reaction.max) * factor)
      if (components.valveReaction > 0)
        signals.push({
          type: 'valve_reaction_low',
          source: 'valve',
          label: 'Unusually fast reaction time',
          points: components.valveReaction,
          explanation: `Reaction time ${fmt(v!.reactionTimeMs, 0)} ms (points start below ${T.reaction.from} ms, max at ${T.reaction.to} ms).`
        })
    }
    if (v!.kd !== undefined) {
      const T2 = THRESHOLDS.faceit.kd
      const pts = Math.round(ramp(v!.kd, T2.from, T2.to, T2.max) * factor * 0.6)
      if (pts > 0) {
        components.valveKd = pts
        signals.push({
          type: 'valve_kd_high',
          source: 'valve',
          label: v!.kd >= 1.7 ? 'Very high KD in Valve matches' : 'High KD in Valve matches',
          points: pts,
          explanation: `KD ${fmt(v!.kd)} across ${matches ?? '?'} Valve matches on record (points start at ${T2.from}).`
        })
      }
    }
    if (v!.headshotAccuracy !== undefined) {
      components.valveHsAccuracy = Math.round(ramp(v!.headshotAccuracy, T.hsAccuracy.from, T.hsAccuracy.to, T.hsAccuracy.max) * factor)
      if (components.valveHsAccuracy > 0)
        signals.push({
          type: 'valve_hs_accuracy_high',
          source: 'valve',
          label: 'Very high headshot accuracy',
          points: components.valveHsAccuracy,
          explanation: `${fmt(v!.headshotAccuracy, 1)}% of shots hit the head (points start at ${T.hsAccuracy.from}%, max at ${T.hsAccuracy.to}%).`
        })
    }
    if (smallSample) notes.push(`Only ${matches} Valve matches on record: performance points halved (noisy sample).`)

    const perf = components.valveRating + components.valvePreaim + components.valveReaction + components.valveHsAccuracy + components.valveKd
    const allowed = perf >= THRESHOLDS.contextGate
    valveAllowed = allowed

    let valveWin = 0
    if (v!.winRate !== undefined && matches !== undefined && matches >= 20) {
      valveWin = Math.round(ramp(v!.winRate, T.winRate.from, T.winRate.to, T.winRate.max))
      if (valveWin > 0)
        signals.push({
          type: 'valve_win_rate_high',
          source: 'valve',
          label: 'Unusual Valve win rate',
          points: valveWin,
          explanation: `Win rate ${fmt(v!.winRate, 0)}% over ${matches} Valve matches (points start at ${T.winRate.from}%).`
        })
    }

    if (v!.premierRating !== undefined && v!.premierRating > 0 && perf >= T.minPerfForMismatch) {
      const band = T.mismatch.find((b) => v!.premierRating! < b.belowRating)
      if (band) {
        components.valveRatingMismatch = band.points
        signals.push({
          type: 'valve_rating_mismatch',
          source: 'valve',
          label: 'Aim metrics do not match Premier rating',
          points: band.points,
          explanation: `Premier rating ${v!.premierRating} with aim metrics typical of much higher ratings.`
        })
      }
    }

    const valveMatchCount = matchCountPoints(matches, allowed, signals, notes, 'valve')
    components.matchCount = Math.max(components.matchCount, valveMatchCount)

    valveScore = Math.min(
      100,
      components.valveRating +
        components.valvePreaim +
        components.valveReaction +
        components.valveHsAccuracy +
        components.valveKd +
        valveWin +
        components.valveRatingMismatch +
        valveMatchCount +
        (allowed ? agePts : 0)
    )
    components.winRate = Math.max(components.winRate, valveWin)
  } else if (v) notes.push('Valve profile found on Leetify but without statistics (private or no matches).')
  else notes.push('No Valve match data (Leetify).')

  // ---- shared account-age context signal ------------------------------------
  if (agePts > 0) {
    if (faceitAllowed || valveAllowed) {
      components.accountAge = agePts
      const platforms = [faceitAllowed ? 'FACEIT' : '', valveAllowed ? 'Valve' : ''].filter(Boolean).join(' and ')
      signals.push({
        type: 'young_account',
        source: 'account',
        label: account.ageSource === 'steam' ? 'Young Steam account' : 'Young FACEIT account',
        points: agePts,
        explanation: `${account.ageSource === 'steam' ? 'Steam account created' : 'FACEIT account activated'} ~${fmt(account.ageMonths!, 1)} months ago, combined with ${platforms} performance anomalies.`
      })
    } else if (faceitScore !== undefined || valveScore !== undefined) {
      notes.push(`Young account (${fmt(account.ageMonths!, 1)} months) ignored: no performance anomaly to combine with.`)
    }
  }

  const score = Math.max(0, Math.min(100, Math.round(Math.max(faceitScore ?? 0, valveScore ?? 0))))
  signals.sort((a, b) => b.points - a.points)
  if (faceitScore === undefined && valveScore === undefined) notes.push('No platform statistics: score is not meaningful.')

  return { score, level: scoreToLevel(score), signals, faceitScore, valveScore, components, notes }
}
