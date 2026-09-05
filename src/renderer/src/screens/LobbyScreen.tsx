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
  key: Team
  title: string
  players: ScoutPlayer[]
}

function groupPlayers(players: ScoutPlayer[]): Group[] {
  const assigned = players.some((p) => p.team !== 'unknown')
  if (!assigned) return [{ key: 'unknown', title: 'Match players', players }]
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
            In CS2 open the console (<code>~</code>), run <code>status</code>, select the output and copy it.
          </span>
        </div>
        {open && (
          <>
            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={'Paste the output of the CS2 `status` command here…'}
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

      {session?.officialServer && players.length > 0 && (
        <div className="notice">
          <b>Official Valve server:</b> CS2 hides Steam IDs in <code>status</code> on Valve matchmaking. Players are matched to FACEIT by
          exact nickname, which is unverified. Rows marked <span className="tag unverified">via faceit</span> may be a different person with
          the same name. After the match, <b>Import last match</b> identifies all ten players exactly through your Leetify profile.
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
        </div>
      ) : (
        groupPlayers(players).map((g) => (
          <div key={g.key} className={`group ${g.key}`}>
            <h2 className="group-title">
              {g.title} <span className="faint">({g.players.length})</span> <span className="line" />
            </h2>
            <PlayerTable players={g.players} selectedId={selectedId} showScore={showScore} map={session?.map} onSelect={onSelect} onCycleTeam={onSetTeam} />
          </div>
        ))
      )}
    </div>
  )
}
