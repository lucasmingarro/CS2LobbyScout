import { Fragment, useState, type JSX } from 'react'
import type { ScoutPlayer, Team } from '@shared/types'
import { banSummary, fmtInt, fmtNum, fmtPct, identityLabel, sourceLabel } from '../format'
import { ScoreBadge } from './ScoreBadge'
import { Sources } from './Sources'

type SortKey = 'score' | 'premier' | 'elo' | 'name'

interface Props {
  players: ScoutPlayer[]
  selectedId?: string
  showScore: boolean
  /** Current map (de_mirage, cs_office, ...) to show the competitive rank on it. */
  map?: string
  onSelect: (key: string) => void
  onCycleTeam: (key: string, next: Team) => void
}

const nextTeam: Record<Team, Team> = { unknown: 'enemy', enemy: 'mine', mine: 'unknown' }
const teamLabel: Record<Team, string> = { unknown: 'team?', enemy: 'enemy', mine: 'my team' }

function sortValue(p: ScoutPlayer, key: SortKey): number | string {
  switch (key) {
    case 'score':
      return p.scout.faceitScore !== undefined || p.scout.valveScore !== undefined ? p.scout.score : -1
    case 'premier':
      return p.valve?.premierRating ?? -1
    case 'elo':
      return p.faceit?.elo ?? -1
    case 'name':
      return p.name.toLowerCase()
  }
}

const fmtRating = (v: number | undefined): string => (v === undefined ? '–' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}`)

export function PlayerTable({ players, selectedId, showScore, map, onSelect, onCycleTeam }: Props): JSX.Element {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'score', dir: -1 })

  const sorted = [...players].sort((a, b) => {
    const va = sortValue(a, sort.key)
    const vb = sortValue(b, sort.key)
    if (va < vb) return -1 * sort.dir
    if (va > vb) return 1 * sort.dir
    return 0
  })

  const header = (key: SortKey, label: string, num = false): JSX.Element => (
    <th
      className={`sortable ${num ? 'num' : ''} ${sort.key === key ? 'sorted' : ''}`}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((s.dir * -1) as 1 | -1) : key === 'name' ? 1 : -1 }))}
    >
      {label}
      {sort.key === key ? (sort.dir === -1 ? ' ▾' : ' ▴') : ''}
    </th>
  )

  return (
    <table className="lobby dual">
      <thead>
        <tr>
          {header('name', 'Player')}
          <th>Team</th>
          <th>Platform</th>
          <th className="num">Rating</th>
          <th className="num">Lvl / Rank</th>
          <th className="num">Matches</th>
          <th className="num">Win</th>
          <th className="num">KD</th>
          <th className="num">ADR</th>
          <th className="num">HS</th>
          <th className="num">Form</th>
          <th>Bans</th>
          {showScore && header('score', 'Score', true)}
          <th>Src</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((p) => {
          const bans = banSummary(p)
          const v = p.valve
          const f = p.faceit
          const selected = selectedId === p.key
          const compRank = map && v?.competitiveRanks ? v.competitiveRanks[map] : undefined
          const valveStatus = p.sources.valve
          const faceitStatus = p.sources.faceit
          const rowClass = `row ${selected ? 'selected' : ''}`
          const form = v?.recent ? `${v.recent.wins}W ${v.recent.losses}L` : '–'
          return (
            <Fragment key={p.key}>
              <tr className={`${rowClass} first`} onClick={() => onSelect(p.key)}>
                <td rowSpan={2}>
                  <div className="player-cell">
                    {p.avatarUrl ? <img className="avatar" src={p.avatarUrl} alt="" /> : <div className="avatar" />}
                    <div>
                      <div className="player-name" title={p.name}>
                        {p.name} {p.isLocal && <span className="tag you">you</span>} {p.watched && <span className="tag watch">watch</span>}
                        {p.steam?.profilePrivate && <span className="tag private">private</span>}
                        {p.identity === 'faceit_name' && <span className="tag unverified" title={identityLabel.faceit_name}>via faceit</span>}
                        {p.identity === 'leetify_match' && <span className="tag verified" title={identityLabel.leetify_match}>match</span>}
                      </div>
                      <div className="player-sub">
                        {p.steamId ?? (faceitStatus === 'pending' ? 'resolving…' : 'Steam ID hidden by server')}
                        {p.steam?.cs2Hours !== undefined && <span className="faint"> · {fmtInt(p.steam.cs2Hours)} h</span>}
                      </div>
                    </div>
                  </div>
                </td>
                <td rowSpan={2}>
                  <button
                    className={`team-btn ${p.team}`}
                    title="Click to cycle team assignment"
                    onClick={(e) => {
                      e.stopPropagation()
                      onCycleTeam(p.key, nextTeam[p.team])
                    }}
                  >
                    {teamLabel[p.team]}
                  </button>
                </td>
                {/* ---- Valve line ---- */}
                <td className="platform valve">Valve</td>
                {valveStatus === 'ok' && v && v.premierRating !== undefined ? (
                  <>
                    <td className="num premier" title="Premier rating">{fmtInt(v.premierRating)}</td>
                    <td className="num" title="Competitive rank on this map (0-18)">{compRank !== undefined && compRank > 0 ? compRank : '–'}</td>
                    <td className="num">{fmtInt(v.totalMatches)}</td>
                    <td className="num">{fmtPct(v.winRate)}</td>
                    <td className="num" title="Leetify rating">{fmtRating(v.leetifyRating)}</td>
                    <td className="num" title="Pre-aim (°) / reaction (ms)">
                      {v.preaim !== undefined ? `${v.preaim.toFixed(1)}°` : '–'}
                      <span className="faint"> {v.reactionTimeMs !== undefined ? `${fmtInt(v.reactionTimeMs)}ms` : ''}</span>
                    </td>
                    <td className="num" title="Headshot accuracy">{fmtPct(v.headshotAccuracy)}</td>
                    <td className="num" title={`Last ${v.recent?.matches ?? 0} Valve matches`}>{form}</td>
                  </>
                ) : (
                  <td colSpan={8} className="dim">
                    {valveStatus === 'pending' ? 'loading…' : valveStatus === 'ok' ? 'no Valve statistics (private on Leetify)' : `Valve: ${sourceLabel[valveStatus]}`}
                  </td>
                )}
                <td rowSpan={2}>{bans.danger ? <span className="tag ban">{bans.text}</span> : <span className="dim">{bans.text}</span>}</td>
                {showScore && (
                  <td className="num" rowSpan={2}>
                    <ScoreBadge player={p} />
                    <div className="sub-scores">
                      <span title="Valve sub-score">V {p.scout.valveScore ?? '–'}</span>
                      <span title="FACEIT sub-score">F {p.scout.faceitScore ?? '–'}</span>
                    </div>
                  </td>
                )}
                <td rowSpan={2}>
                  <Sources s={p.sources} />
                </td>
              </tr>
              <tr className={`${rowClass} second`} onClick={() => onSelect(p.key)}>
                {/* ---- FACEIT line ---- */}
                <td className="platform faceit">FACEIT</td>
                {faceitStatus === 'ok' && f ? (
                  <>
                    <td className="num" title="FACEIT ELO">{fmtInt(f.elo)}</td>
                    <td className="num" title="FACEIT level">{fmtInt(f.level)}</td>
                    <td className="num">{fmtInt(f.matches)}</td>
                    <td className="num">{fmtPct(f.winRate)}</td>
                    <td className="num">{fmtNum(f.kd)}</td>
                    <td className="num">{fmtInt(f.adr)}</td>
                    <td className="num">{fmtPct(f.headshotPercentage)}</td>
                    <td className="num" title={`Last ${f.recent?.matches ?? 0} FACEIT matches`}>
                      {f.recent?.winRate !== undefined ? `${fmtInt(f.recent.winRate)}% W` : '–'}
                    </td>
                  </>
                ) : (
                  <td colSpan={8} className="dim">
                    {faceitStatus === 'pending' ? 'loading…' : faceitStatus === 'not_found' ? 'FACEIT: not found' : `FACEIT: ${sourceLabel[faceitStatus]}`}
                  </td>
                )}
              </tr>
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}
