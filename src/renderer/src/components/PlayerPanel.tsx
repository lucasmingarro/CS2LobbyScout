import { Fragment, useEffect, useState, type JSX } from 'react'
import type { PlayerHistory, ScoutPlayer } from '@shared/types'
import { levelLabel } from '@shared/types'
import { steamProfileUrl } from '@shared/steam-id'
import { accountAge, fmtDate, fmtInt, fmtNum, fmtPct, scoreAvailable, sourceLabel } from '../format'
import { ScoreBadge } from './ScoreBadge'

interface Props {
  player: ScoutPlayer
  showScore: boolean
  showSignals: boolean
  onClose: () => void
  onWatch: (steamId: string, watched: boolean) => void
  onRefresh: (steamId: string) => void
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="section">
      <h3>
        {title} <span className="line" />
      </h3>
      {children}
    </div>
  )
}

export function PlayerPanel({ player: p, showScore, showSignals, onClose, onWatch, onRefresh }: Props): JSX.Element {
  const [history, setHistory] = useState<PlayerHistory | undefined>()
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    let alive = true
    void window.scout.playerHistory(p.steamId).then((h) => alive && setHistory(h))
    return () => {
      alive = false
    }
  }, [p.steamId, p.scout.score, p.watched])

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      await onRefresh(p.steamId)
    } finally {
      setRefreshing(false)
    }
  }

  const s = p.steam
  const f = p.faceit
  const bans = (s?.vacBans ?? 0) + (s?.gameBans ?? 0)

  return (
    <div className="panel-inner">
      <div className="panel-head">
        {p.avatarUrl ? <img className="avatar lg" src={p.avatarUrl} alt="" /> : <div className="avatar lg" />}
        <div>
          <h2>{p.name}</h2>
          <div className="faint mono">{p.steamId}</div>
          <div className="dim">
            {p.isLocal && <span className="tag you">you</span>} {p.watched && <span className="tag watch">watching</span>}
          </div>
        </div>
        <button className="btn sm ghost close" onClick={onClose} title="Close">
          ✕
        </button>
      </div>

      {showScore && (
        <Section title="Scout">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <ScoreBadge player={p} large />
            <div>
              <div>
                Suspicion Score {scoreAvailable(p) ? <span className="mono">{p.scout.score} / 100</span> : <span className="dim">unavailable</span>}
              </div>
              {scoreAvailable(p) ? (
                <div className={`level-text ${p.scout.level}`}>{levelLabel(p.scout.level)} statistical anomaly</div>
              ) : (
                <div className="faint">FACEIT stats are required to compute a score.</div>
              )}
            </div>
          </div>
          {showSignals && scoreAvailable(p) && (
            <>
              <h3 style={{ marginTop: 12 }}>Why?</h3>
              {p.scout.signals.length === 0 ? (
                <div className="dim">No statistical anomalies above threshold.</div>
              ) : (
                <ul className="signals">
                  {p.scout.signals.map((sig) => (
                    <li key={sig.type} className="signal">
                      <span className="pts">+{sig.points}</span>
                      <span>
                        <div className="label">{sig.label}</div>
                        <div className="why">{sig.explanation}</div>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {p.scout.notes.length > 0 && (
                <ul className="notes">
                  {p.scout.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Section>
      )}

      <Section title={`Steam · ${sourceLabel[p.sources.steam]}`}>
        <dl className="kv">
          <dt>Profile</dt>
          <dd>{s?.profilePrivate === undefined ? '–' : s.profilePrivate ? 'PRIVATE' : 'public'}</dd>
          <dt>Account age</dt>
          <dd>{accountAge(s?.accountCreatedAt)}</dd>
          <dt>CS2 hours</dt>
          <dd>{fmtInt(s?.cs2Hours)}</dd>
          <dt>VAC bans</dt>
          <dd className={s?.vacBans ? 'danger' : ''}>{fmtInt(s?.vacBans)}</dd>
          <dt>Game bans</dt>
          <dd className={s?.gameBans ? 'danger' : ''}>{fmtInt(s?.gameBans)}</dd>
          {bans > 0 && (
            <>
              <dt>Days since last ban</dt>
              <dd>{fmtInt(s?.daysSinceLastBan)}</dd>
            </>
          )}
        </dl>
      </Section>

      <Section title={`FACEIT · ${sourceLabel[p.sources.faceit]}`}>
        {f ? (
          <dl className="kv">
            <dt>Nickname</dt>
            <dd>{f.nickname ?? '–'}</dd>
            <dt>Level</dt>
            <dd>{fmtInt(f.level)}</dd>
            <dt>ELO</dt>
            <dd>{fmtInt(f.elo)}</dd>
            <dt>Matches</dt>
            <dd>{fmtInt(f.matches)}</dd>
            <dt>KD</dt>
            <dd>{fmtNum(f.kd)}</dd>
            <dt>ADR</dt>
            <dd>{fmtInt(f.adr)}</dd>
            <dt>HS</dt>
            <dd>{fmtPct(f.headshotPercentage)}</dd>
            <dt>Win rate</dt>
            <dd>{fmtPct(f.winRate)}</dd>
            {f.recent && (
              <>
                <dt>Last {f.recent.matches} · KD / ADR</dt>
                <dd>
                  {fmtNum(f.recent.kd)} / {fmtInt(f.recent.adr)}
                </dd>
              </>
            )}
          </dl>
        ) : (
          <div className="dim">{p.sources.faceit === 'not_found' ? 'FACEIT: Not found' : sourceLabel[p.sources.faceit]}</div>
        )}
      </Section>

      <Section title="History">
        <dl className="kv">
          <dt>Times seen</dt>
          <dd>{p.history.timesSeen}</dd>
          <dt>First seen</dt>
          <dd>{fmtDate(p.history.firstSeen)}</dd>
          <dt>Last seen</dt>
          <dd>{fmtDate(p.history.lastSeen)}</dd>
        </dl>
        {history && history.scores.length > 1 && (
          <>
            <div className="dim" style={{ marginTop: 8 }}>
              Previous scores
            </div>
            <div className="history-list">
              {history.scores.slice(0, 8).map((sc, i) => (
                <Fragment key={i}>
                  <span className="faint">{fmtDate(sc.capturedAt)}</span>
                  <span>{sc.score}</span>
                </Fragment>
              ))}
            </div>
          </>
        )}
      </Section>

      <div className="panel-actions">
        <button className={`btn ${p.watched ? '' : 'primary'}`} onClick={() => onWatch(p.steamId, !p.watched)}>
          {p.watched ? 'Unwatch' : 'Watch player'}
        </button>
        <button className="btn" onClick={refresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
        <button className="btn" onClick={() => void window.scout.openExternal(s?.profileUrl ?? steamProfileUrl(p.steamId))}>
          Steam profile
        </button>
        {f?.profileUrl && (
          <button className="btn" onClick={() => void window.scout.openExternal(f.profileUrl!)}>
            FACEIT profile
          </button>
        )}
      </div>

      <div className="disclaimer">
        The Suspicion Score measures statistical anomaly against fixed thresholds. It is not evidence of cheating.
      </div>
    </div>
  )
}
