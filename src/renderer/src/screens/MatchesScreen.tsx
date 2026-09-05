import { useCallback, useEffect, useState, type JSX } from 'react'
import type { MatchSummary } from '@shared/types'
import { fmtDateTime } from '../format'

interface Props {
  refreshToken: number
  onOpen: (matchId: string) => void
  onImport: () => Promise<string | undefined>
}

const modeLabel: Record<MatchSummary['mode'], string> = { premier: 'Premier', competitive: 'Competitive', wingman: 'Wingman', other: 'Other' }

export function MatchesScreen({ refreshToken, onOpen, onImport }: Props): JSX.Element {
  const [rows, setRows] = useState<MatchSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | undefined>()

  const load = useCallback(async () => setRows(await window.scout.listMatches()), [])
  useEffect(() => {
    void load()
  }, [load, refreshToken])

  const doImport = async (): Promise<void> => {
    setBusy(true)
    setMessage(undefined)
    try {
      setMessage(await onImport())
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="toolbar">
        <h2 className="group-title" style={{ margin: 0 }}>
          Imported Valve matches <span className="faint">({rows.length})</span>
        </h2>
        <span className="spacer" />
        {message && <span className="dim">{message}</span>}
        <button className="btn primary" onClick={doImport} disabled={busy}>
          {busy ? 'Importing…' : 'Import last matches'}
        </button>
      </div>
      <div className="notice">
        Matches come from your <b>Leetify</b> profile (leetify.com, sign in with Steam and add the Steam match authentication code). Each
        match lists the exact Steam IDs and teams of all ten players. Import right after a match finishes to identify the lobby you just
        played.
      </div>
      {rows.length === 0 ? (
        <div className="empty">
          <h2>No matches imported</h2>
          <div>Click “Import last matches” after a Premier or Competitive game.</div>
        </div>
      ) : (
        <table className="lobby">
          <thead>
            <tr>
              <th>Played</th>
              <th>Mode</th>
              <th>Map</th>
              <th className="num">Score</th>
              <th>Result</th>
              <th className="num">Players</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.matchId} className="row" onClick={() => onOpen(m.matchId)}>
                <td className="dim">{fmtDateTime(m.playedAt)}</td>
                <td>{modeLabel[m.mode]}</td>
                <td>{m.map ?? '–'}</td>
                <td className="num">
                  {m.myScore ?? '–'} : {m.theirScore ?? '–'}
                </td>
                <td>
                  <span className={`tag result-${m.result ?? 'unknown'}`}>{m.result ?? 'unknown'}</span>
                </td>
                <td className="num">{m.playerCount}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn sm">Open</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
