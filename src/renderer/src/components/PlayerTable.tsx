import { useState, type JSX } from 'react'
import type { ScoutPlayer, Team } from '@shared/types'
import { banSummary, fmtInt, fmtNum, fmtPct } from '../format'
import { ScoreBadge } from './ScoreBadge'
import { Sources } from './Sources'

type SortKey = 'score' | 'elo' | 'kd' | 'hs' | 'matches' | 'name'

interface Props {
  players: ScoutPlayer[]
  selectedId?: string
  showScore: boolean
  onSelect: (steamId: string) => void
  onCycleTeam: (steamId: string, next: Team) => void
}

const nextTeam: Record<Team, Team> = { unknown: 'enemy', enemy: 'mine', mine: 'unknown' }
const teamLabel: Record<Team, string> = { unknown: 'team?', enemy: 'enemy', mine: 'my team' }

function sortValue(p: ScoutPlayer, key: SortKey): number | string {
  switch (key) {
    case 'score':
      return p.sources.faceit === 'ok' ? p.scout.score : -1
    case 'elo':
      return p.faceit?.elo ?? -1
    case 'kd':
      return p.faceit?.kd ?? -1
    case 'hs':
      return p.faceit?.headshotPercentage ?? -1
    case 'matches':
      return p.faceit?.matches ?? -1
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
    <table className="lobby">
      <thead>
        <tr>
          {header('name', 'Player')}
          <th>Team</th>
          <th className="num">Lvl</th>
          {header('elo', 'ELO', true)}
          {header('kd', 'KD', true)}
          <th className="num">ADR</th>
          {header('hs', 'HS', true)}
          {header('matches', 'Matches', true)}
          <th className="num">Win</th>
          <th className="num">Hours</th>
          <th>Bans</th>
          {showScore && header('score', 'Score', true)}
          <th>Src</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((p) => {
          const bans = banSummary(p)
          return (
            <tr key={p.steamId} className={`row ${selectedId === p.steamId ? 'selected' : ''}`} onClick={() => onSelect(p.steamId)}>
              <td>
                <div className="player-cell">
                  {p.avatarUrl ? <img className="avatar" src={p.avatarUrl} alt="" /> : <div className="avatar" />}
                  <div>
                    <div className="player-name" title={p.name}>
                      {p.name} {p.isLocal && <span className="tag you">you</span>} {p.watched && <span className="tag watch">watch</span>}
                      {p.steam?.profilePrivate && <span className="tag private">private</span>}
                    </div>
                    <div className="player-sub">{p.faceit?.nickname && p.faceit.nickname !== p.name ? `FACEIT: ${p.faceit.nickname}` : p.steamId}</div>
                  </div>
                </div>
              </td>
              <td>
                <button
                  className={`team-btn ${p.team}`}
                  title="Click to cycle team assignment"
                  onClick={(e) => {
                    e.stopPropagation()
                    onCycleTeam(p.steamId, nextTeam[p.team])
                  }}
                >
                  {teamLabel[p.team]}
                </button>
              </td>
              <td className="num">{fmtInt(p.faceit?.level)}</td>
              <td className="num">{fmtInt(p.faceit?.elo)}</td>
              <td className="num">{fmtNum(p.faceit?.kd)}</td>
              <td className="num">{fmtInt(p.faceit?.adr)}</td>
              <td className="num">{fmtPct(p.faceit?.headshotPercentage)}</td>
              <td className="num">{fmtInt(p.faceit?.matches)}</td>
              <td className="num">{fmtPct(p.faceit?.winRate)}</td>
              <td className="num">{fmtInt(p.steam?.cs2Hours)}</td>
              <td>{bans.danger ? <span className="tag ban">{bans.text}</span> : <span className="dim">{bans.text}</span>}</td>
              {showScore && (
                <td className="num">
                  <ScoreBadge player={p} />
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
