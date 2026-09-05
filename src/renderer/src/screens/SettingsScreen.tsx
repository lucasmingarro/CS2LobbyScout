import { useEffect, useState, type JSX } from 'react'
import type { ApiKeyStatus, AppSettings } from '@shared/types'

interface Props {
  settings: AppSettings
  keyStatus: ApiKeyStatus
  onChange: (patch: Partial<AppSettings>) => void
  onKeysChanged: () => void
  logs: string[]
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return <div className={`switch ${value ? 'on' : ''}`} role="switch" aria-checked={value} onClick={() => onChange(!value)} />
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="setting">
      <div className="desc">
        {label}
        {hint && <small>{hint}</small>}
      </div>
      {children}
    </div>
  )
}

export function SettingsScreen({ settings, keyStatus, onChange, onKeysChanged, logs }: Props): JSX.Element {
  const [steamKey, setSteamKey] = useState('')
  const [faceitKey, setFaceitKey] = useState('')
  const [mySteamId, setMySteamId] = useState(settings.mySteamId)
  const [info, setInfo] = useState<{ version: string; userDataPath: string; counts: { players: number; watched: number; sessions: number; cache: number } }>()
  const [notice, setNotice] = useState<string | undefined>()

  useEffect(() => {
    void window.scout.appInfo().then(setInfo)
  }, [notice])

  useEffect(() => setMySteamId(settings.mySteamId), [settings.mySteamId])

  const saveKeys = async (): Promise<void> => {
    const patch: { steam?: string; faceit?: string } = {}
    if (steamKey.trim()) patch.steam = steamKey.trim()
    if (faceitKey.trim()) patch.faceit = faceitKey.trim()
    if (!patch.steam && !patch.faceit) return
    await window.scout.setKeys(patch)
    setSteamKey('')
    setFaceitKey('')
    onKeysChanged()
    setNotice('API keys saved.')
  }

  const clearKeys = async (): Promise<void> => {
    await window.scout.setKeys({ steam: '', faceit: '' })
    onKeysChanged()
    setNotice('Stored API keys removed.')
  }

  const saveSteamId = (): void => {
    const v = mySteamId.trim()
    if (v && !/^7656119\d{10}$/.test(v)) {
      setNotice('That does not look like a Steam64 ID (17 digits starting with 7656119).')
      return
    }
    onChange({ mySteamId: v })
    setNotice(v ? 'Your Steam ID was saved.' : 'Your Steam ID was cleared.')
  }

  const status = (ok: boolean, source: string): JSX.Element =>
    ok ? <span className="ok">configured ({source})</span> : <span className="missing">missing</span>

  return (
    <div className="settings">
      <h2>API keys</h2>
      <div className="key-status" style={{ marginBottom: 8 }}>
        Steam: {status(keyStatus.steam, keyStatus.steamSource)} · FACEIT: {status(keyStatus.faceit, keyStatus.faceitSource)}
        <div className="faint">
          Keys from a <code>.env</code> file take precedence in development. Keys saved here are encrypted with the OS keychain when available.
        </div>
      </div>
      <Row label="Steam Web API key" hint="steamcommunity.com/dev/apikey">
        <input type="password" value={steamKey} onChange={(e) => setSteamKey(e.target.value)} placeholder={keyStatus.steam ? '••••••••' : 'paste key'} />
      </Row>
      <Row label="FACEIT Data API key" hint="developers.faceit.com — create an app and a server-side API key">
        <input type="password" value={faceitKey} onChange={(e) => setFaceitKey(e.target.value)} placeholder={keyStatus.faceit ? '••••••••' : 'paste key'} />
      </Row>
      <div className="setting" style={{ borderBottom: 'none' }}>
        <div className="desc" />
        <button className="btn primary" onClick={saveKeys} disabled={!steamKey.trim() && !faceitKey.trim()}>
          Save keys
        </button>
        <button className="btn ghost" onClick={clearKeys}>
          Remove stored keys
        </button>
      </div>

      <h2>Identity</h2>
      <Row label="My Steam64 ID" hint="Lets the app mark your row as “You” and pre-assign your team.">
        <input type="text" className="mono" value={mySteamId} onChange={(e) => setMySteamId(e.target.value)} placeholder="7656119…" />
        <button className="btn" onClick={saveSteamId}>
          Save
        </button>
      </Row>

      <h2>General</h2>
      <Row label="Auto-detect clipboard" hint="Watch the clipboard for CS2 status output.">
        <Toggle value={settings.autoDetectClipboard} onChange={(v) => onChange({ autoDetectClipboard: v })} />
      </Row>
      <Row label="Auto-load detected lobby" hint="Load immediately instead of asking.">
        <Toggle value={settings.autoLoadDetectedLobby} onChange={(v) => onChange({ autoLoadDetectedLobby: v })} />
      </Row>
      <Row label="Save encounter history" hint="Store every lobby and player seen in the local database.">
        <Toggle value={settings.saveEncounterHistory} onChange={(v) => onChange({ saveEncounterHistory: v })} />
      </Row>
      <Row label="Ban recheck interval (hours)" hint="How often watched players are rechecked while the app is open. 0 disables.">
        <input
          type="number"
          min={0}
          max={168}
          value={settings.banRecheckIntervalHours}
          onChange={(e) => onChange({ banRecheckIntervalHours: Number(e.target.value) })}
          style={{ width: 90 }}
        />
      </Row>

      <h2>Display</h2>
      <Row label="Always on top">
        <Toggle value={settings.alwaysOnTop} onChange={(v) => onChange({ alwaysOnTop: v })} />
      </Row>
      <Row label="Compact mode">
        <Toggle value={settings.compactMode} onChange={(v) => onChange({ compactMode: v })} />
      </Row>

      <h2>Scouting</h2>
      <Row label="Show suspicion score">
        <Toggle value={settings.showSuspicionScore} onChange={(v) => onChange({ showSuspicionScore: v })} />
      </Row>
      <Row label="Show signal details">
        <Toggle value={settings.showSignalDetails} onChange={(v) => onChange({ showSignalDetails: v })} />
      </Row>

      <h2>Data</h2>
      {info && (
        <div className="dim" style={{ marginBottom: 8 }}>
          {info.counts.players} players · {info.counts.watched} watched · {info.counts.sessions} sessions · {info.counts.cache} cached responses
          <div className="faint mono">{info.userDataPath}</div>
        </div>
      )}
      <div className="setting" style={{ borderBottom: 'none' }}>
        <button
          className="btn"
          onClick={async () => {
            await window.scout.clearCache()
            setNotice('API cache cleared.')
          }}
        >
          Clear cache
        </button>
        <button
          className="btn danger"
          onClick={async () => {
            if (!window.confirm('Delete all players, encounters, snapshots, scores and ban events? This cannot be undone.')) return
            await window.scout.clearHistory()
            setNotice('History cleared.')
          }}
        >
          Clear history
        </button>
      </div>

      <h2>Debug</h2>
      <Row label="Debug mode" hint="Verbose logs and raw status text stored with each session.">
        <Toggle value={settings.debugMode} onChange={(v) => onChange({ debugMode: v })} />
      </Row>
      {settings.debugMode && <div className="logbox">{logs.join('\n')}</div>}

      {notice && (
        <div className="dim" style={{ marginTop: 16 }}>
          {notice}
        </div>
      )}
      {info && (
        <div className="faint" style={{ marginTop: 16 }}>
          CS2 Lobby Scout v{info.version}
        </div>
      )}
    </div>
  )
}
