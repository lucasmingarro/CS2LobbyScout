import { useState, type JSX } from 'react'
import type { ScoutPlayer, Team } from '@shared/types'
import { banSummary, fmtInt, fmtNum, fmtPct, identityLabel, sourceLabel } from '../format'
import { ScoreBadge } from './ScoreBadge'
import { Sources } from './Sources'

type SortKey = 'score' | 'elo' | 'name'

interface Props {
  players: ScoutPlayer[]
  selectedId?: string
  showScore: boolean
  onSelect: (key: string) => void
  onCycleTeam: (key: string, next: Team) => void
}

const nextTeam: Record<Team, Team> = { unknown: 'enemy', enemy: 'mine', mine: 'unknown' }
const teamLabel: Record<Team, string> = { unknown: 'team?', enemy: 'enemy', mine: 'my team' }

function sortValue(p: ScoutPlayer, key: SortKey): number | string {
  switch (key) {
    case 'score':
      return p.scout.faceitScore !== undefined || p.scout.valveScore !== undefined ? p.scout.score : -1
    case 'elo':
      return p.faceit?.elo ?? -1
    case 'name':
      return p.name.toLowerCase()
  }
}

export function PlayerTable({ players, selectedId, showScore, onSelect, onCycleTeam }: Props): JSX.Element {
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
          <th className="num">ELO</th>
          <th className="num">Level</th>
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
          const f = p.faceit
          const selected = selectedId === p.key
          const faceitStatus = p.sources.faceit
          const rowClass = `row ${selected ? 'selected' : ''}`
          return (
            <tr key={p.key} className={rowClass} onClick={() => onSelect(p.key)}>
              <td>
                <div className="player-cell">
                  {p.avatarUrl ? <img className="avatar" src={p.avatarUrl} alt="" /> : <div className="avatar" />}
                  <div>
                    <div className="player-name" title={p.name}>
                      {p.name} {p.isLocal && <span className="tag you">you</span>} {p.watched && <span className="tag watch">watch</span>}
                      {p.steam?.profilePrivate && <span className="tag private">private</span>}
                      {p.identity === 'faceit_name' && <span className="tag unverified" title={identityLabel.faceit_name}>via faceit</span>}
                      {p.identity === 'leetify_match' && <span className="tag verified" title={identityLabel.leetify_match}>match</span>}
                      {p.matchStats?.party !== undefined && <span className="tag party" title="Players sharing this number queued together">party {p.matchStats.party}</span>}
                    </div>
                    <div className="player-sub">
                      {p.steamId ?? (faceitStatus === 'pending' ? 'resolving…' : 'Steam ID hidden by server')}
                      {p.steam?.cs2Hours !== undefined && <span className="faint"> · {fmtInt(p.steam.cs2Hours)} h</span>}
                    </div>
                    {p.matchStats && (
                      <div className="player-sub mono" title="This match: ADR · HS% · score">
                        {p.matchStats.adr !== undefined ? `${fmtInt(p.matchStats.adr)} ADR` : ''}
                        {p.matchStats.headshotPercentage !== undefined ? ` · ${fmtInt(p.matchStats.headshotPercentage)}% HS` : ''}
                        {` · ${p.matchStats.score} pts`}
                      </div>
                    )}
                  </div>
                </div>
              </td>
              <td>
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
              <td>{bans.danger ? <span className="tag ban">{bans.text}</span> : <span className="dim">{bans.text}</span>}</td>
              {showScore && (
                <td className="num">
                  <ScoreBadge player={p} />
                  <div className="sub-scores">
                    <span title="FACEIT sub-score">F {p.scout.faceitScore ?? '–'}</span>
                  </div>
                </td>
              )}
              <td>
                <Sources s={p.sources} />
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
