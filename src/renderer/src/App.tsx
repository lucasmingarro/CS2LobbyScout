import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { ApiKeyStatus, AppSettings, LobbySession, ScoutPlayer, Team } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { LobbyScreen } from './screens/LobbyScreen'
import { WatchedScreen } from './screens/WatchedScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { MatchesScreen } from './screens/MatchesScreen'
import { PlayerPanel } from './components/PlayerPanel'
import { Toasts, type Toast } from './components/Toasts'

type Tab = 'lobby' | 'matches' | 'watched' | 'settings'

export default function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('lobby')
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus>({ steam: false, faceit: false, steamSource: 'none', faceitSource: 'none' })
  const [session, setSession] = useState<LobbySession | undefined>()
  const [players, setPlayers] = useState<Map<string, ScoutPlayer>>(new Map())
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [toasts, setToasts] = useState<Toast[]>([])
  const [pendingBans, setPendingBans] = useState(0)
  const [watchedRefresh, setWatchedRefresh] = useState(0)
  const [logs, setLogs] = useState<string[]>([])
  const toastId = useRef(1)

  const pushToast = useCallback((t: Omit<Toast, 'id'>): void => {
    const id = toastId.current++
    setToasts((ts) => [...ts, { ...t, id }])
    if (!t.actionLabel) setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 6000)
  }, [])

  const dismissToast = (id: number): void => setToasts((ts) => ts.filter((x) => x.id !== id))

  const applySession = useCallback((s: LobbySession): void => {
    setSession(s)
    setPlayers(new Map(s.players.map((p) => [p.key, p])))
    setSelectedId(undefined)
    setTab('lobby')
  }, [])

  const refreshKeys = useCallback(() => void window.scout.keyStatus().then(setKeyStatus), [])
  const refreshPendingBans = useCallback(() => void window.scout.listBanEvents(true).then((e) => setPendingBans(e.length)), [])

  // Initial load + subscriptions.
  useEffect(() => {
    void window.scout.getSettings().then(setSettings)
    refreshKeys()
    refreshPendingBans()
    void window.scout.appInfo().then((info) => info.session && applySession(info.session))

    const offs = [
      window.scout.onPlayerUpdated((p) => {
        setPlayers((prev) => {
          if (!prev.has(p.key)) return prev
          const next = new Map(prev)
          next.set(p.key, p)
          return next
        })
      }),
      window.scout.onLobbyDetected((e) => {
        if (e.autoLoaded && e.session) {
          applySession(e.session)
          pushToast({ kind: 'info', title: `Lobby loaded from clipboard (${e.playerCount} players)` })
        } else if (e.raw) {
          const raw = e.raw
          pushToast({
            kind: 'info',
            title: `CS2 status detected in clipboard`,
            body: `${e.playerCount} players found. Load this lobby?`,
            actionLabel: 'Load',
            onAction: () => void loadLobby(raw, 'clipboard')
          })
        }
      }),
      window.scout.onBanDetected((ev) => {
        refreshPendingBans()
        setWatchedRefresh((n) => n + 1)
        pushToast({
          kind: 'danger',
          title: `${ev.gameBans > ev.previousGameBans ? 'Game' : 'VAC'} ban detected: ${ev.name}`,
          body: `Scout score when seen: ${ev.scoreWhenSeen ?? '–'}`,
          actionLabel: 'View',
          onAction: () => setTab('watched')
        })
      }),
      window.scout.onLog((line) => setLogs((l) => [...l.slice(-299), line]))
    ]
    return () => offs.forEach((off) => off())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadLobby = async (raw: string, source: 'paste' | 'clipboard' = 'paste'): Promise<void> => {
    setLoading(true)
    setError(undefined)
    try {
      const s = await window.scout.loadLobby(raw, source)
      applySession(s)
    } catch (err) {
      const msg = (err as Error).message.replace(/^.*Error: /, '')
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const setTeam = async (key: string, team: Team): Promise<void> => {
    const updated = await window.scout.setTeam(key, team)
    if (updated) setPlayers((prev) => new Map(prev).set(key, updated))
  }

  const watch = async (key: string, watched: boolean): Promise<void> => {
    const now = await window.scout.watchPlayer(key, watched)
    setPlayers((prev) => {
      const p = prev.get(key)
      if (!p) return prev
      return new Map(prev).set(key, { ...p, watched: now })
    })
    setWatchedRefresh((n) => n + 1)
  }

  const refreshPlayer = async (key: string): Promise<void> => {
    const p = await window.scout.refreshPlayer(key)
    if (p) setPlayers((prev) => new Map(prev).set(key, p))
  }

  const [matchesRefresh, setMatchesRefresh] = useState(0)

  const importMatches = async (): Promise<string | undefined> => {
    const r = await window.scout.importLastMatches(10)
    setMatchesRefresh((n) => n + 1)
    if (r.error && r.imported === 0) return r.error
    const parts = [`${r.imported} imported`, `${r.skipped} already known`]
    if (r.backfilled) parts.push(`${r.backfilled} lobby player(s) identified`)
    if (r.error) parts.push(r.error)
    return parts.join(' · ')
  }

  const openMatch = async (matchId: string): Promise<void> => {
    const s = await window.scout.openMatch(matchId)
    if (s) applySession(s)
  }

  const changeSettings = async (patch: Partial<AppSettings>): Promise<void> => {
    const next = await window.scout.setSettings(patch)
    setSettings(next)
  }

  const playerList = useMemo(() => [...players.values()], [players])
  const selected = selectedId ? players.get(selectedId) : undefined
  const missingKeys = !keyStatus.steam || !keyStatus.faceit

  return (
    <div className={`app ${settings.compactMode ? 'compact' : ''}`}>
      <header className="header">
        <div className="brand">
          CS2 LOBBY SCOUT
          {session && (
            <small>
              {session.match ? `${session.match.mode} · ` : ''}{session.players.length} players{session.map ? ` · ${session.map}` : ''} ·{' '}
              {new Date(session.match?.playedAt ?? session.createdAt).toLocaleString()}
            </small>
          )}
        </div>
        <nav className="tabs">
          <button className={`tab ${tab === 'lobby' ? 'active' : ''}`} onClick={() => setTab('lobby')}>
            Lobby
          </button>
          <button className={`tab ${tab === 'matches' ? 'active' : ''}`} onClick={() => setTab('matches')}>
            Matches
          </button>
          <button className={`tab ${tab === 'watched' ? 'active' : ''}`} onClick={() => setTab('watched')}>
            Watched {pendingBans > 0 && <span className="pill">{pendingBans}</span>}
          </button>
          <button className={`tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>
            Settings
          </button>
        </nav>
        <div className="header-actions">
          {missingKeys && (
            <button className="btn sm" onClick={() => setTab('settings')} title="Configure API keys">
              ⚠ API keys missing
            </button>
          )}
        </div>
      </header>

      <div className="main">
        <div className="content">
          {tab === 'lobby' && (
            <LobbyScreen
              session={session}
              players={playerList}
              selectedId={selectedId}
              showScore={settings.showSuspicionScore}
              loading={loading}
              error={error}
              onLoad={(raw) => loadLobby(raw, 'paste')}
              onImport={importMatches}
              onSelect={(id) => setSelectedId((cur) => (cur === id ? undefined : id))}
              onSetTeam={setTeam}
            />
          )}
          {tab === 'matches' && <MatchesScreen refreshToken={matchesRefresh} onOpen={openMatch} onImport={importMatches} />}
          {tab === 'watched' && <WatchedScreen refreshToken={watchedRefresh} />}
          {tab === 'settings' && (
            <SettingsScreen settings={settings} keyStatus={keyStatus} onChange={changeSettings} onKeysChanged={refreshKeys} logs={logs} />
          )}
        </div>
        {tab === 'lobby' && selected && (
          <aside className="panel">
            <PlayerPanel
              player={selected}
              showScore={settings.showSuspicionScore}
              showSignals={settings.showSignalDetails}
              onClose={() => setSelectedId(undefined)}
              onWatch={watch}
              onRefresh={refreshPlayer}
            />
          </aside>
        )}
      </div>

      <footer className="statusbar">
        <span>
          Steam <span className={keyStatus.steam ? 'ok' : 'missing'}>{keyStatus.steam ? '✓' : 'no key'}</span>
        </span>
        <span>
          FACEIT <span className={keyStatus.faceit ? 'ok' : 'missing'}>{keyStatus.faceit ? '✓' : 'no key'}</span>
        </span>
        <span>Clipboard {settings.autoDetectClipboard ? 'watching' : 'off'}</span>
        <span className="spacer" />
        <span>Scores measure statistical anomaly, not cheating.</span>
      </footer>

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
