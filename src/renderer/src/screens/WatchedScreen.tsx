import { useCallback, useEffect, useState, type JSX } from 'react'
import type { BanEvent, WatchedPlayerRow } from '@shared/types'
import { scoreToLevel } from '@shared/types'
import { steamProfileUrl } from '@shared/steam-id'
import { fmtDate, fmtDateTime } from '../format'

interface Props {
  refreshToken: number
  onOpenPlayer?: (steamId: string) => void
}

export function WatchedScreen({ refreshToken }: Props): JSX.Element {
  const [rows, setRows] = useState<WatchedPlayerRow[]>([])
  const [events, setEvents] = useState<BanEvent[]>([])
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState<string | undefined>()

  const load = useCallback(async () => {
    const [w, e] = await Promise.all([window.scout.listWatched(), window.scout.listBanEvents(false)])
    setRows(w)
    setEvents(e)
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshToken])

  const recheck = async (): Promise<void> => {
    setChecking(true)
    setMessage(undefined)
    try {
      const r = await window.scout.recheckBans()
      if (r.error) setMessage(`Recheck failed: ${r.error}`)
      else setMessage(`Checked ${r.checked} watched player(s). ${r.changed.length} new ban(s) detected.`)
      await load()
    } finally {
      setChecking(false)
    }
  }

  const unwatch = async (steamId: string): Promise<void> => {
    await window.scout.watchPlayer(steamId, false)
    await load()
  }

  const ack = async (id: number): Promise<void> => {
    await window.scout.ackBanEvent(id)
    await load()
  }

  const banLabel: Record<WatchedPlayerRow['banState'], string> = { none: '-', vac: 'VAC BAN', game: 'GAME BAN', both: 'VAC + GAME BAN' }
  const pending = events.filter((e) => !e.acknowledged)

  return (
    <div>
      <div className="toolbar">
        <h2 className="group-title" style={{ margin: 0 }}>
          Watched players <span className="faint">({rows.length})</span>
        </h2>
        <span className="spacer" />
        {message && <span className="dim">{message}</span>}
        <button className="btn primary" onClick={recheck} disabled={checking || rows.length === 0}>
          {checking ? 'Checking…' : 'Recheck bans'}
        </button>
      </div>

      {pending.length > 0 && (
        <div className="ban-events">
          {pending.map((e) => (
            <div key={e.id} className="ban-card">
              <div className="body">
                <div className="title">{e.gameBans > e.previousGameBans ? 'GAME BAN DETECTED' : 'VAC BAN DETECTED'}</div>
                <div>
                  <b>{e.name}</b> <span className="mono faint">{e.steamId}</span>
                </div>
                <div className="meta">
                  First seen {fmtDate(e.firstSeen)} · Scout score when seen {e.scoreWhenSeen ?? '–'} · Ban detected {fmtDateTime(e.detectedAt)}
                </div>
              </div>
              <button className="btn sm" onClick={() => void window.scout.openExternal(steamProfileUrl(e.steamId))}>
                Steam
              </button>
              <button className="btn sm" onClick={() => ack(e.id)}>
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="empty">
          <h2>No watched players</h2>
          <div>Open a player from the lobby and click “Watch player” to follow them across sessions.</div>
        </div>
      ) : (
        <table className="lobby">
          <thead>
            <tr>
              <th>Player</th>
              <th>First seen</th>
              <th>Last seen</th>
              <th className="num">Seen</th>
              <th className="num">Score</th>
              <th>Ban</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.steamId} className="row">
                <td>
                  <div className="player-cell">
                    {r.avatarUrl ? <img className="avatar" src={r.avatarUrl} alt="" /> : <div className="avatar" />}
                    <div>
                      <div className="player-name">{r.name}</div>
                      <div className="player-sub mono">{r.steamId}</div>
                    </div>
                  </div>
                </td>
                <td className="dim">{fmtDate(r.firstSeen)}</td>
                <td className="dim">{fmtDate(r.lastSeen)}</td>
                <td className="num">{r.timesSeen}</td>
                <td className="num">
                  {r.lastScore === undefined ? <span className="score na">n/a</span> : <span className={`score ${scoreToLevel(r.lastScore)}`}>{r.lastScore}</span>}
                </td>
                <td>{r.banState === 'none' ? <span className="dim">-</span> : <span className="tag ban">{banLabel[r.banState]}</span>}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn sm" onClick={() => void window.scout.openExternal(steamProfileUrl(r.steamId))}>
                    Steam
                  </button>{' '}
                  <button className="btn sm ghost" onClick={() => unwatch(r.steamId)}>
                    Unwatch
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {events.length > pending.length && (
        <div className="section">
          <h3>
            Ban history <span className="line" />
          </h3>
          <table className="lobby">
            <tbody>
              {events
                .filter((e) => e.acknowledged)
                .map((e) => (
                  <tr key={e.id}>
                    <td>{e.name}</td>
                    <td className="dim">{fmtDateTime(e.detectedAt)}</td>
                    <td>
                      <span className="tag ban">{e.gameBans > e.previousGameBans ? 'GAME BAN' : 'VAC BAN'}</span>
                    </td>
                    <td className="num">score {e.scoreWhenSeen ?? '–'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
