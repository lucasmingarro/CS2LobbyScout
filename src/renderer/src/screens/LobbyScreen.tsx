import { useState, type JSX } from 'react'
import type { LobbySession, ScoutPlayer, Team } from '@shared/types'
import { PlayerTable } from '../components/PlayerTable'

interface Props {
  session?: LobbySession
  players: ScoutPlayer[]
  selectedId?: string
  showScore: boolean
  loading: boolean
  error?: string
  onLoad: (raw: string) => Promise<void>
  onSelect: (steamId: string) => void
  onSetTeam: (steamId: string, team: Team) => void
}

interface Group {
  key: Team | 'faction1' | 'faction2'
  title: string
  players: ScoutPlayer[]
}

function groupPlayers(players: ScoutPlayer[], session?: LobbySession): Group[] {
  const assigned = players.some((p) => p.team !== 'unknown')
  if (!assigned) {
    // FACEIT match of someone else: neutral grouping by faction nickname, no "you" marker.
    const fm = session?.faceitMatch
    if (fm && players.some((p) => p.faction)) {
      const groups: Group[] = [
        { key: 'faction1', title: fm.factionNames.faction1, players: players.filter((p) => p.faction === 'faction1') },
        { key: 'faction2', title: fm.factionNames.faction2, players: players.filter((p) => p.faction === 'faction2') }
      ]
      return groups.filter((g) => g.players.length > 0)
    }
    return [{ key: 'unknown', title: 'Match players', players }]
  }
  const groups: Group[] = [
    { key: 'enemy', title: 'Enemy team', players: players.filter((p) => p.team === 'enemy') },
    { key: 'mine', title: 'Your team', players: players.filter((p) => p.team === 'mine') },
    { key: 'unknown', title: 'Unassigned', players: players.filter((p) => p.team === 'unknown') }
  ]
  return groups.filter((g) => g.players.length > 0)
}

export function LobbyScreen({ session, players, selectedId, showScore, loading, error, onLoad, onSelect, onSetTeam }: Props): JSX.Element {
  const [raw, setRaw] = useState('')
  const [open, setOpen] = useState(players.length === 0)

  const submit = async (): Promise<void> => {
    if (!raw.trim()) return
    await onLoad(raw)
    setRaw('')
    setOpen(false)
  }

  const pasteFromClipboard = async (): Promise<void> => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        setRaw(text)
        await onLoad(text)
        setOpen(false)
      }
    } catch {
      setOpen(true)
    }
  }

  return (
    <div>
      <div className="paste-box">
        <div className="paste-actions">
          <button className="btn primary" onClick={pasteFromClipboard} disabled={loading}>
            {loading ? 'Loading…' : 'Paste lobby'}
          </button>
          <button className="btn" onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide text box' : 'Paste manually'}
          </button>
          <span className="hint">
            In CS2 open the console (<code>~</code>), run <code>status</code>, select the output and copy it. On FACEIT, copy the match room
            URL instead.
          </span>
        </div>
        {open && (
          <>
            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={'Paste CS2 `status` output or a FACEIT match room URL here…'}
              spellCheck={false}
            />
            <div className="paste-actions">
              <button className="btn primary" onClick={submit} disabled={!raw.trim() || loading}>
                Load lobby
              </button>
              <button className="btn" onClick={() => setRaw('')} disabled={!raw}>
                Clear
              </button>
            </div>
          </>
        )}
        {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
      </div>

      {session?.faceitMatch && (
        <div className="notice">
          <b>FACEIT match</b> · {session.faceitMatch.status}
          {session.faceitMatch.mapPick ? <> · {session.faceitMatch.mapPick}</> : null}. Identities come verified from the match roster.
        </div>
      )}
      {session?.match && (
        <div className="notice">
          <b>Imported match</b> · {session.match.mode} on {session.match.map ?? '?'} · {session.match.myScore ?? '–'} : {session.match.theirScore ?? '–'} (
          {session.match.result ?? 'unknown'}). Teams and per-match K/D come from the match itself.
        </div>
      )}
      {session?.officialServer && !session.match && players.length > 0 && (
        <div className="notice">
          <b>Official Valve server:</b> CS2 hides Steam IDs in <code>status</code> on Valve matchmaking. Players are matched to FACEIT by
          exact nickname, which is unverified. Rows marked <span className="tag unverified">via faceit</span> may be a different person with
          the same name.
        </div>
      )}

      {players.length === 0 ? (
        <div className="empty">
          <h2>No lobby loaded</h2>
          <div>Scout the players in your current match in three steps:</div>
          <ol>
            <li>
              In CS2 press <code>~</code> and type <code>status</code>
            </li>
            <li>Select the console output and copy it (Ctrl+C)</li>
            <li>
              Click <b>Paste lobby</b> here, or let clipboard detection pick it up
            </li>
          </ol>
          <div>
            On FACEIT: copy the match room URL (<code>faceit.com/…/cs2/room/…</code>) during the veto and paste it here — the full lobby
            loads before the game starts.
          </div>
        </div>
      ) : (
        groupPlayers(players, session).map((g) => (
          <div key={g.key} className={`group ${g.key}`}>
            <h2 className="group-title">
              {g.title} <span className="faint">({g.players.length})</span> <span className="line" />
            </h2>
            <PlayerTable players={g.players} selectedId={selectedId} showScore={showScore} onSelect={onSelect} onCycleTeam={onSetTeam} />
          </div>
        ))
      )}
    </div>
  )
}
