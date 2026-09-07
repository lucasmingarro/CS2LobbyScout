import type { IdentitySource, ScoutPlayer, SourceStatus } from '@shared/types'

export const fmtNum = (v: number | undefined, digits = 2): string => (v === undefined ? '–' : v.toFixed(digits))
export const fmtInt = (v: number | undefined): string => (v === undefined ? '–' : Math.round(v).toString())
export const fmtPct = (v: number | undefined): string => (v === undefined ? '–' : `${Math.round(v)}%`)

export function fmtDate(iso: string | undefined): string {
  if (!iso) return '–'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '–'
  return d.toISOString().slice(0, 10)
}

export function fmtDateTime(iso: string | undefined): string {
  if (!iso) return '–'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '–'
  return d.toLocaleString()
}

export function accountAge(iso: string | undefined): string {
  if (!iso) return 'unknown'
  const ms = Date.now() - Date.parse(iso)
  if (Number.isNaN(ms)) return 'unknown'
  const months = ms / (1000 * 60 * 60 * 24 * 30.4375)
  if (months < 1) return `${Math.max(1, Math.round(ms / 86_400_000))} days`
  if (months < 24) return `${Math.round(months)} months`
  return `${(months / 12).toFixed(1)} years`
}

export const sourceLabel: Record<SourceStatus, string> = {
  pending: 'loading',
  ok: '✓',
  not_found: 'not found',
  unavailable: 'unavailable',
  no_key: 'no API key',
  skipped: 'skipped',
  no_id: 'no Steam ID'
}

export const identityLabel: Record<IdentitySource, string> = {
  status: 'Steam ID from status',
  faceit_name: 'matched by FACEIT nickname (unverified)',
  faceit_match: 'identified from the FACEIT match roster (verified)',
  leetify_match: 'identified from your Leetify match (exact)',
  self: 'you (configured Steam ID)',
  none: 'Steam ID unknown'
}

export function banSummary(p: ScoutPlayer): { text: string; danger: boolean } {
  const vac = p.steam?.vacBans ?? 0
  const game = p.steam?.gameBans ?? 0
  if (p.steam?.vacBans === undefined) return { text: '–', danger: false }
  if (vac === 0 && game === 0) return { text: '0', danger: false }
  const parts: string[] = []
  if (vac) parts.push(`${vac} VAC`)
  if (game) parts.push(`${game} game`)
  return { text: parts.join(' + '), danger: true }
}

export function scoreAvailable(p: ScoutPlayer): boolean {
  return p.scout.faceitScore !== undefined || p.scout.valveScore !== undefined
}
