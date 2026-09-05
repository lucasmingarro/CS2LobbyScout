import { describe, expect, it } from 'vitest'
import { computeScore, THRESHOLDS } from '@shared/scout-engine'
import { scoreToLevel, type FaceitInfo, type SteamInfo, type ValveInfo } from '@shared/types'

const NOW = new Date('2026-09-05T12:00:00Z')
const monthsAgo = (m: number): string => new Date(NOW.getTime() - m * 30.4375 * 86_400_000).toISOString()

const average: FaceitInfo = { level: 6, elo: 1450, matches: 722, kd: 1.09, adr: 78, headshotPercentage: 44, winRate: 51 }
const oldSteam: SteamInfo = { profilePrivate: false, accountCreatedAt: monthsAgo(60), vacBans: 0, gameBans: 0 }

describe('computeScore', () => {
  it('is deterministic and zero for an average player', () => {
    const a = computeScore({ steam: oldSteam, faceit: average }, NOW)
    const b = computeScore({ steam: oldSteam, faceit: average }, NOW)
    expect(a).toEqual(b)
    expect(a.score).toBe(0)
    expect(a.level).toBe('low')
    expect(a.signals).toEqual([])
  })

  it('scores the spec example "aim.exe" as high/very high with explainable signals', () => {
    const r = computeScore(
      {
        steam: { profilePrivate: false, accountCreatedAt: monthsAgo(5), vacBans: 0, gameBans: 0 },
        faceit: { level: 4, elo: 1180, matches: 91, kd: 1.82, adr: 116, headshotPercentage: 74, winRate: 68 }
      },
      NOW
    )
    expect(r.score).toBeGreaterThanOrEqual(70)
    expect(['high', 'very_high']).toContain(r.level)
    const types = r.signals.map((s) => s.type)
    expect(types).toEqual(expect.arrayContaining(['kd_high', 'adr_high', 'hs_high', 'faceit_low_match_count', 'young_account', 'win_rate_high']))
    expect(r.faceitScore).toBe(r.score)
    expect(r.valveScore).toBeUndefined()
    // every point is explained
    const sum = r.signals.reduce((a, s) => a + s.points, 0)
    expect(sum).toBe(r.score)
    for (const s of r.signals) expect(s.explanation.length).toBeGreaterThan(10)
  })

  it('never exceeds 100 and caps each component', () => {
    const r = computeScore(
      {
        steam: { accountCreatedAt: monthsAgo(1) },
        faceit: { matches: 150, kd: 3.5, adr: 200, headshotPercentage: 95, winRate: 99, recent: { matches: 20, kd: 9, adr: 400 } }
      },
      NOW
    )
    // Full "low match count" points (<50 matches) and the performance-jump signal (>=100 matches)
    // are mutually exclusive by design, so the practical ceiling is below 100.
    expect(r.score).toBe(94)
    expect(r.score).toBeLessThanOrEqual(100)
    expect(r.components.kd).toBe(THRESHOLDS.faceit.kd.max)
    expect(r.components.adr).toBe(THRESHOLDS.faceit.adr.max)
    expect(r.components.hs).toBe(THRESHOLDS.faceit.hs.max)
    expect(r.components.performanceJump).toBe(10)
    expect(r.components.winRate).toBe(THRESHOLDS.faceit.winRate.max)
    expect(r.components.accountAge).toBe(10)
    expect(r.components.matchCount).toBe(4)
    expect(Object.values(r.components).reduce((a, b) => a + b, 0)).toBe(r.score)
  })

  it('does NOT flag a new account or low match count without a performance anomaly', () => {
    const r = computeScore({ steam: { accountCreatedAt: monthsAgo(1) }, faceit: { ...average, matches: 30 } }, NOW)
    expect(r.score).toBe(0)
    expect(r.components.accountAge).toBe(0)
    expect(r.components.matchCount).toBe(0)
    expect(r.notes.join(' ')).toMatch(/ignored/)
  })

  describe('Valve sub-score (Leetify data)', () => {
    const avgValve: ValveInfo = { premierRating: 8654, leetifyRating: -3.87, totalMatches: 348, winRate: 39.3, preaim: 12.5, reactionTimeMs: 678, headshotAccuracy: 11 }

    it('scores an average Premier player at zero', () => {
      const r = computeScore({ valve: avgValve }, NOW)
      expect(r.valveScore).toBe(0)
      expect(r.faceitScore).toBeUndefined()
      expect(r.score).toBe(0)
    })

    it('flags pro-like aim metrics on a low Premier rating with a mismatch signal', () => {
      const r = computeScore({ valve: { premierRating: 7000, leetifyRating: 7.5, totalMatches: 120, winRate: 70, preaim: 3, reactionTimeMs: 340, headshotAccuracy: 35 } }, NOW)
      expect(r.valveScore).toBeGreaterThanOrEqual(80)
      const types = r.signals.map((s) => s.type)
      expect(types).toEqual(
        expect.arrayContaining(['valve_rating_high', 'valve_preaim_low', 'valve_reaction_low', 'valve_hs_accuracy_high', 'valve_rating_mismatch', 'valve_win_rate_high'])
      )
      for (const sig of r.signals) expect(sig.source).toBe('valve')
      expect(r.score).toBe(r.valveScore)
    })

    it('does not apply the mismatch signal to high ratings or weak anomalies', () => {
      const high = computeScore({ valve: { premierRating: 25000, leetifyRating: 7.5, totalMatches: 500, preaim: 3, reactionTimeMs: 340, headshotAccuracy: 35 } }, NOW)
      expect(high.components.valveRatingMismatch).toBe(0)
      const weak = computeScore({ valve: { premierRating: 5000, leetifyRating: 3.5, totalMatches: 500, preaim: 12, reactionTimeMs: 700, headshotAccuracy: 12 } }, NOW)
      expect(weak.components.valveRatingMismatch).toBe(0)
    })

    it('ramps "lower is worse" metrics correctly', () => {
      expect(computeScore({ valve: { totalMatches: 100, preaim: 6 } }, NOW).components.valvePreaim).toBe(0)
      expect(computeScore({ valve: { totalMatches: 100, preaim: 2.5 } }, NOW).components.valvePreaim).toBe(20)
      expect(computeScore({ valve: { totalMatches: 100, preaim: 4.25 } }, NOW).components.valvePreaim).toBe(10)
      expect(computeScore({ valve: { totalMatches: 100, reactionTimeMs: 320 } }, NOW).components.valveReaction).toBe(15)
    })

    it('overall score is the higher platform sub-score and account age is shared', () => {
      const r = computeScore(
        {
          steam: { accountCreatedAt: monthsAgo(2) },
          faceit: { matches: 300, kd: 1.9, adr: 100, headshotPercentage: 60 },
          valve: { premierRating: 15000, leetifyRating: 1, totalMatches: 300, preaim: 10, reactionTimeMs: 650, headshotAccuracy: 12 }
        },
        NOW
      )
      expect(r.faceitScore!).toBeGreaterThan(r.valveScore!)
      expect(r.score).toBe(r.faceitScore)
      expect(r.signals.filter((s) => s.type === 'young_account')).toHaveLength(1)
      expect(r.components.accountAge).toBe(10)
    })
  })

  it('does not add points for a private steam profile / missing data', () => {
    const withAge = computeScore({ steam: { profilePrivate: false, accountCreatedAt: monthsAgo(2) }, faceit: { ...average, kd: 1.9 } }, NOW)
    const priv = computeScore({ steam: { profilePrivate: true }, faceit: { ...average, kd: 1.9 } }, NOW)
    expect(priv.components.accountAge).toBe(0)
    expect(priv.score).toBeLessThan(withAge.score)
    expect(priv.notes.join(' ')).toMatch(/private/)
    expect(computeScore({}, NOW).score).toBe(0)
  })

  it('halves performance points for tiny samples', () => {
    const big = computeScore({ faceit: { matches: 500, kd: 2.0 } }, NOW)
    const tiny = computeScore({ faceit: { matches: 5, kd: 2.0 } }, NOW)
    expect(big.components.kd).toBe(25)
    expect(tiny.components.kd).toBe(13) // round(12.5)
  })

  it('ramps linearly between thresholds', () => {
    const mid = (THRESHOLDS.faceit.kd.from + THRESHOLDS.faceit.kd.to) / 2
    const r = computeScore({ faceit: { matches: 500, kd: mid } }, NOW)
    expect(r.components.kd).toBe(Math.round(THRESHOLDS.faceit.kd.max / 2))
    expect(computeScore({ faceit: { matches: 500, kd: THRESHOLDS.faceit.kd.from } }, NOW).components.kd).toBe(0)
  })

  it('detects a recent performance jump only with enough history', () => {
    const jump = computeScore({ faceit: { ...average, recent: { matches: 20, kd: 1.7, adr: 110 } } }, NOW)
    expect(jump.components.performanceJump).toBeGreaterThan(0)
    expect(jump.signals.find((s) => s.type === 'performance_jump')?.explanation).toMatch(/Last 20 FACEIT matches/)

    const tooFew = computeScore({ faceit: { ...average, matches: 50, recent: { matches: 20, kd: 1.7, adr: 110 } } }, NOW)
    expect(tooFew.components.performanceJump).toBe(0)
  })

  it('uses FACEIT activation as a weaker account-age proxy', () => {
    const steamAge = computeScore({ steam: { accountCreatedAt: monthsAgo(2) }, faceit: { ...average, kd: 2.0 } }, NOW)
    const faceitAge = computeScore({ faceit: { ...average, kd: 2.0, activatedAt: monthsAgo(2) } }, NOW)
    expect(steamAge.components.accountAge).toBe(10)
    expect(faceitAge.components.accountAge).toBe(6)
  })

  it('maps scores to the documented bands', () => {
    const cases: Array<[number, string]> = [
      [0, 'low'],
      [29, 'low'],
      [30, 'mild'],
      [49, 'mild'],
      [50, 'elevated'],
      [69, 'elevated'],
      [70, 'high'],
      [84, 'high'],
      [85, 'very_high'],
      [100, 'very_high']
    ]
    for (const [score, level] of cases) expect(scoreToLevel(score)).toBe(level)
  })
})
