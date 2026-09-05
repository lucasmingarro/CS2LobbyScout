import type { FaceitInfo, ScoutResult, ScoutSignal, SteamInfo } from './types'
import { scoreToLevel } from './types'

/**
 * Suspicion Engine v1.
 *
 * Deterministic, explainable, fixed-threshold scoring. It measures *statistical
 * anomaly*, never "cheating". Every point awarded is attached to a signal with
 * a human readable explanation so the UI can always answer "why?".
 *
 * Component budget (max 100):
 *   KD anomaly            0–25
 *   ADR anomaly           0–20
 *   HS% anomaly           0–15
 *   Account age           0–10   (context signal, see below)
 *   Low match count       0–10   (context signal, see below)
 *   Win-rate anomaly      0–10
 *   Performance jump      0–10
 *
 * Rules that prevent simplistic logic:
 *  - Thresholds ramp linearly: a KD of 1.3 gives a few points, 2.0 gives the max.
 *  - "Context" signals (young account, low match count) only count when at
 *    least one *performance* anomaly is present. A new account with average
 *    stats scores 0.
 *  - Very small samples (< MIN_RELIABLE_MATCHES) halve performance points.
 *  - Missing data never adds points. Private Steam profile => account age unknown => 0.
 *  - Existing VAC/game bans are shown as facts in the UI but are NOT part of the score.
 */

export const ENGINE_VERSION = 1

export const THRESHOLDS = {
  kd: { from: 1.25, to: 2.0, max: 25 },
  adr: { from: 85, to: 120, max: 20 },
  hs: { from: 55, to: 75, max: 15 },
  winRate: { from: 58, to: 75, max: 10 },
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
  jump: {
    kdRatio: { from: 1.15, to: 1.5, max: 6 },
    adrRatio: { from: 1.12, to: 1.4, max: 4 },
    minLifetimeMatches: 100,
    minRecentMatches: 10
  },
  /** Below this many matches, performance stats are treated as noisy. */
  minReliableMatches: 10,
  /** Context signals only apply once performance points reach this amount. */
  contextGate: 8
} as const

export interface ScoutInput {
  steam?: SteamInfo
  faceit?: FaceitInfo
}

function ramp(value: number, from: number, to: number, max: number): number {
  if (value <= from) return 0
  if (value >= to) return max
  return ((value - from) / (to - from)) * max
}

function monthsBetween(fromIso: string, now: Date): number | undefined {
  const t = Date.parse(fromIso)
  if (Number.isNaN(t)) return undefined
  const ms = now.getTime() - t
  if (ms < 0) return 0
  return ms / (1000 * 60 * 60 * 24 * 30.4375)
}

function fmt(n: number, digits = 2): string {
  return Number.isFinite(n) ? n.toFixed(digits) : '?'
}

export function computeScore(input: ScoutInput, now: Date = new Date()): ScoutResult {
  const signals: ScoutSignal[] = []
  const notes: string[] = []
  const f = input.faceit
  const s = input.steam

  const components = { kd: 0, adr: 0, hs: 0, accountAge: 0, matchCount: 0, winRate: 0, performanceJump: 0 }

  const matches = f?.matches
  const smallSample = matches !== undefined && matches < THRESHOLDS.minReliableMatches
  const sampleFactor = smallSample ? 0.5 : 1

  // ---- Performance anomalies -------------------------------------------------
  if (f?.kd !== undefined) {
    const raw = ramp(f.kd, THRESHOLDS.kd.from, THRESHOLDS.kd.to, THRESHOLDS.kd.max) * sampleFactor
    components.kd = Math.round(raw)
    if (components.kd > 0) {
      signals.push({
        type: 'kd_high',
        label: f.kd >= 1.7 ? 'Very high KD' : 'High KD',
        points: components.kd,
        explanation: `Lifetime KD ${fmt(f.kd)} (points start at ${THRESHOLDS.kd.from}, max at ${THRESHOLDS.kd.to}).`
      })
    }
  } else notes.push('KD unavailable (no FACEIT stats).')

  if (f?.adr !== undefined) {
    const raw = ramp(f.adr, THRESHOLDS.adr.from, THRESHOLDS.adr.to, THRESHOLDS.adr.max) * sampleFactor
    components.adr = Math.round(raw)
    if (components.adr > 0) {
      signals.push({
        type: 'adr_high',
        label: f.adr >= 110 ? 'Very high ADR' : 'High ADR',
        points: components.adr,
        explanation: `Lifetime ADR ${fmt(f.adr, 0)} (points start at ${THRESHOLDS.adr.from}, max at ${THRESHOLDS.adr.to}).`
      })
    }
  } else notes.push('ADR unavailable.')

  if (f?.headshotPercentage !== undefined) {
    const raw =
      ramp(f.headshotPercentage, THRESHOLDS.hs.from, THRESHOLDS.hs.to, THRESHOLDS.hs.max) * sampleFactor
    components.hs = Math.round(raw)
    if (components.hs > 0) {
      signals.push({
        type: 'hs_high',
        label: f.headshotPercentage >= 68 ? 'Very high HS%' : 'High HS%',
        points: components.hs,
        explanation: `Lifetime headshot rate ${fmt(f.headshotPercentage, 0)}% (points start at ${THRESHOLDS.hs.from}%, max at ${THRESHOLDS.hs.to}%).`
      })
    }
  } else notes.push('HS% unavailable.')

  if (smallSample) notes.push(`Only ${matches} FACEIT matches: performance points halved (noisy sample).`)

  const performancePoints = components.kd + components.adr + components.hs
  const contextAllowed = performancePoints >= THRESHOLDS.contextGate

  // ---- Win rate --------------------------------------------------------------
  if (f?.winRate !== undefined && matches !== undefined && matches > 0) {
    let raw = ramp(f.winRate, THRESHOLDS.winRate.from, THRESHOLDS.winRate.to, THRESHOLDS.winRate.max)
    if (matches < 20) raw *= 0.5
    components.winRate = Math.round(raw)
    if (components.winRate > 0) {
      signals.push({
        type: 'win_rate_high',
        label: 'Unusual win rate',
        points: components.winRate,
        explanation: `Win rate ${fmt(f.winRate, 0)}% over ${matches} matches (points start at ${THRESHOLDS.winRate.from}%).`
      })
    }
  }

  // ---- Context signals (gated) ----------------------------------------------
  let ageMonths: number | undefined
  let ageSource: 'steam' | 'faceit' | undefined
  if (s?.accountCreatedAt) {
    ageMonths = monthsBetween(s.accountCreatedAt, now)
    ageSource = 'steam'
  } else if (f?.activatedAt) {
    ageMonths = monthsBetween(f.activatedAt, now)
    ageSource = 'faceit'
  }
  if (ageMonths === undefined) {
    notes.push(
      s?.profilePrivate
        ? 'Steam profile is private: account age unknown, no points added.'
        : 'Account age unknown, no points added.'
    )
  } else {
    const band = THRESHOLDS.accountAgeMonths.find((b) => ageMonths! < b.below)
    if (band) {
      // FACEIT activation is a weaker proxy than Steam creation date.
      let pts = ageSource === 'faceit' ? Math.round(band.points * 0.6) : band.points
      if (!contextAllowed) {
        pts = 0
        notes.push(`Young account (${fmt(ageMonths, 1)} months) ignored: no performance anomaly to combine with.`)
      }
      components.accountAge = pts
      if (pts > 0) {
        signals.push({
          type: 'young_account',
          label: ageSource === 'steam' ? 'Young Steam account' : 'Young FACEIT account',
          points: pts,
          explanation: `${ageSource === 'steam' ? 'Steam account created' : 'FACEIT account activated'} ~${fmt(ageMonths, 1)} months ago, combined with performance anomalies.`
        })
      }
    }
  }

  if (matches !== undefined) {
    const band = THRESHOLDS.matchCount.find((b) => matches < b.below)
    if (band) {
      let pts: number = band.points
      if (!contextAllowed) {
        pts = 0
        notes.push(`Low match count (${matches}) ignored: no performance anomaly to combine with.`)
      }
      components.matchCount = pts
      if (pts > 0) {
        signals.push({
          type: 'low_match_count',
          label: matches < 50 ? 'Very low match count' : 'Low match count',
          points: pts,
          explanation: `${matches} FACEIT matches with above-threshold performance stats.`
        })
      }
    }
  } else if (f) notes.push('Match count unavailable.')

  // ---- Performance jump ------------------------------------------------------
  const r = f?.recent
  if (
    r &&
    matches !== undefined &&
    matches >= THRESHOLDS.jump.minLifetimeMatches &&
    r.matches >= THRESHOLDS.jump.minRecentMatches
  ) {
    let raw = 0
    const parts: string[] = []
    if (r.kd !== undefined && f?.kd && f.kd > 0) {
      const ratio = r.kd / f.kd
      const p = ramp(ratio, THRESHOLDS.jump.kdRatio.from, THRESHOLDS.jump.kdRatio.to, THRESHOLDS.jump.kdRatio.max)
      if (p > 0) parts.push(`KD ${fmt(r.kd)} vs lifetime ${fmt(f.kd)}`)
      raw += p
    }
    if (r.adr !== undefined && f?.adr && f.adr > 0) {
      const ratio = r.adr / f.adr
      const p = ramp(ratio, THRESHOLDS.jump.adrRatio.from, THRESHOLDS.jump.adrRatio.to, THRESHOLDS.jump.adrRatio.max)
      if (p > 0) parts.push(`ADR ${fmt(r.adr, 0)} vs lifetime ${fmt(f.adr, 0)}`)
      raw += p
    }
    components.performanceJump = Math.round(raw)
    if (components.performanceJump > 0) {
      signals.push({
        type: 'performance_jump',
        label: 'Recent performance jump',
        points: components.performanceJump,
        explanation: `Last ${r.matches} matches: ${parts.join(', ')}.`
      })
    }
  } else if (r && matches !== undefined && matches < THRESHOLDS.jump.minLifetimeMatches) {
    notes.push('Performance jump not evaluated: lifetime sample too small.')
  }

  const total = Object.values(components).reduce((a, b) => a + b, 0)
  const score = Math.max(0, Math.min(100, Math.round(total)))
  signals.sort((a, b) => b.points - a.points)

  if (!f) notes.push('No FACEIT data: only account facts are available, score is not meaningful.')

  return { score, level: scoreToLevel(score), signals, components, notes }
}
