import { Fragment, useEffect, useState, type JSX } from 'react'
import type { PlayerHistory, ScoutPlayer } from '@shared/types'
import { levelLabel } from '@shared/types'
import { steamProfileUrl } from '@shared/steam-id'
import { accountAge, fmtDate, fmtInt, fmtNum, fmtPct, identityLabel, scoreAvailable, sourceLabel } from '../format'
import { ScoreBadge } from './ScoreBadge'

interface Props {
  player: ScoutPlayer
  showScore: boolean
  showSignals: boolean
  onClose: () => void
  onWatch: (key: string, watched: boolean) => void
  onRefresh: (key: string) => void
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
    if (p.steamId) void window.scout.playerHistory(p.steamId).then((h) => alive && setHistory(h))
    else setHistory(undefined)
    return () => {
      alive = false
    }
  }, [p.steamId, p.scout.score, p.watched])

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      await onRefresh(p.key)
    } finally {
      setRefreshing(false)
    }
  }

  const s = p.steam
  const f = p.faceit
  const v = p.valve
  const bans = (s?.vacBans ?? 0) + (s?.gameBans ?? 0)
  const fmtRating = (x: number | undefined): string => (x === undefined ? '–' : `${x >= 0 ? '+' : ''}${x.toFixed(2)}`)
  const srcTag: Record<string, string> = { faceit: 'FACEIT', valve: 'Valve', account: 'Account' }

  return (
    <div className="panel-inner">
      <div className="panel-head">
        {p.avatarUrl ? <img className="avatar lg" src={p.avatarUrl} alt="" /> : <div className="avatar lg" />}
        <div>
          <h2>{p.name}</h2>
          <div className="faint mono">{p.steamId ?? 'Steam ID unknown'}</div>
          <div className="dim" title={identityLabel[p.identity]}>
            {p.isLocal && <span className="tag you">you</span>} {p.watched && <span className="tag watch">watching</span>}{' '}
            {p.identity === 'faceit_name' && <span className="tag unverified">matched by FACEIT nickname</span>}
            {p.identity === 'none' && <span className="tag private">not resolved</span>}
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
                <>
                  <div className={`level-text ${p.scout.level}`}>{levelLabel(p.scout.level)} statistical anomaly</div>
                  <div className="faint">
                    Valve {p.scout.valveScore ?? '–'} · FACEIT {p.scout.faceitScore ?? '–'} (overall = higher of the two)
                  </div>
                </>
              ) : (
                <div className="faint">Valve (Leetify) or FACEIT statistics are required to compute a score.</div>
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
                        <div className="label">
                          {sig.label} <span className={`tag src-${sig.source}`}>{srcTag[sig.source]}</span>
                        </div>
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

      {p.matchStats && (
        <Section title="This match">
          <dl className="kv">
            <dt>K / A / D</dt>
            <dd>
              {p.matchStats.kills} / {p.matchStats.assists} / {p.matchStats.deaths}
            </dd>
            <dt>ADR · HS · Score</dt>
            <dd>
              {fmtInt(p.matchStats.adr)} · {fmtPct(p.matchStats.headshotPercentage)} · {p.matchStats.score}
            </dd>
            {p.matchStats.premierRating !== undefined && p.matchStats.premierRating > 0 && (
              <>
                <dt>Premier rating</dt>
                <dd className="premier">
                  {fmtInt(p.matchStats.premierRatingBefore)} → {fmtInt(p.matchStats.premierRating)}
                </dd>
              </>
            )}
            {p.matchStats.premierWins !== undefined && (
              <>
                <dt>Premier wins</dt>
                <dd>{fmtInt(p.matchStats.premierWins)}</dd>
              </>
            )}
            <dt>Leetify rating</dt>
            <dd>{fmtRating(p.matchStats.leetifyRating)}</dd>
            <dt>Pre-aim · reaction</dt>
            <dd>
              {p.matchStats.preaim !== undefined ? `${p.matchStats.preaim.toFixed(1)}°` : '–'} · {fmtInt(p.matchStats.reactionTimeMs)} ms
            </dd>
            {p.matchStats.party !== undefined && (
              <>
                <dt>Party</dt>
                <dd>{p.matchStats.party}</dd>
              </>
            )}
          </dl>
        </Section>
      )}

      <Section title={`Valve · ${sourceLabel[p.sources.valve]}`}>
        {v ? (
          <dl className="kv">
            <dt>Data from</dt>
            <dd className="faint">
              {v.source === 'matches'
                ? `${v.sampleMatches} imported match(es)`
                : v.source === 'mixed'
                  ? `Leetify profile + ${v.sampleMatches} match(es)`
                  : 'Leetify profile'}
            </dd>
            <dt>Premier rating</dt>
            <dd className="premier">
              {fmtInt(v.premierRating)}
              {v.premierRatingThen !== undefined && <span className="faint"> (from {fmtInt(v.premierRatingThen)})</span>}
            </dd>
            {v.premierWins !== undefined && (
              <>
                <dt>Premier wins</dt>
                <dd>{fmtInt(v.premierWins)}</dd>
              </>
            )}
            {v.kd !== undefined && (
              <>
                <dt>KD · ADR</dt>
                <dd>
                  {fmtNum(v.kd)} · {fmtInt(v.adr)}
                </dd>
              </>
            )}
            <dt>Leetify rating</dt>
            <dd>{fmtRating(v.leetifyRating)}</dd>
            <dt>Matches</dt>
            <dd>{fmtInt(v.totalMatches)}</dd>
            <dt>Win rate</dt>
            <dd>{fmtPct(v.winRate)}</dd>
            <dt>Pre-aim</dt>
            <dd>{v.preaim !== undefined ? `${v.preaim.toFixed(1)}°` : '–'}</dd>
            <dt>Reaction time</dt>
            <dd>{v.reactionTimeMs !== undefined ? `${fmtInt(v.reactionTimeMs)} ms` : '–'}</dd>
            <dt>Headshot accuracy</dt>
            <dd>{fmtPct(v.headshotAccuracy)}</dd>
            <dt>Spray accuracy</dt>
            <dd>{fmtPct(v.sprayAccuracy)}</dd>
            {v.ratings && (
              <>
                <dt>Aim / Positioning / Utility</dt>
                <dd>
                  {fmtInt(v.ratings.aim)} / {fmtInt(v.ratings.positioning)} / {fmtInt(v.ratings.utility)}
                </dd>
              </>
            )}
            {v.recent && (
              <>
                <dt>Last {v.recent.matches} matches</dt>
                <dd>
                  {v.recent.wins}W {v.recent.losses}L {v.recent.ties}T · {fmtRating(v.recent.avgLeetifyRating)}
                </dd>
                {v.recent.premierNow !== undefined && v.recent.premierThen !== undefined && (
                  <>
                    <dt>Premier trend</dt>
                    <dd>
                      {fmtInt(v.recent.premierThen)} → {fmtInt(v.recent.premierNow)}
                    </dd>
                  </>
                )}
              </>
            )}
            {v.competitiveRanks && Object.values(v.competitiveRanks).some((r) => r > 0) && (
              <>
                <dt>Competitive ranks</dt>
                <dd className="faint" style={{ whiteSpace: 'normal' }}>
                  {Object.entries(v.competitiveRanks)
                    .filter(([, r]) => r > 0)
                    .map(([m, r]) => `${m.replace(/^(de|cs)_/, '')} ${r}`)
                    .join(' · ')}
                </dd>
              </>
            )}
            {v.headshotPercentage !== undefined && (
              <>
                <dt>Headshot %</dt>
                <dd>{fmtPct(v.headshotPercentage)}</dd>
              </>
            )}
            {v.firstMatchAt && (
              <>
                <dt>First Valve match seen</dt>
                <dd>{fmtDate(v.firstMatchAt)}</dd>
              </>
            )}
          </dl>
        ) : (
          <div className="dim">
            {p.sources.valve === 'not_found' || p.sources.valve === 'ok'
              ? 'No Valve data yet. Import the match this player was in (Matches tab) — imported matches carry the Premier rating and stats of all ten players, whether or not they use Leetify.'
              : sourceLabel[p.sources.valve]}
          </div>
        )}
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
          <div className="dim">
            {p.sources.faceit === 'not_found'
              ? p.identity === 'none'
                ? 'FACEIT: no account with this exact nickname'
                : 'FACEIT: Not found'
              : sourceLabel[p.sources.faceit]}
          </div>
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
        <button
          className={`btn ${p.watched ? '' : 'primary'}`}
          onClick={() => onWatch(p.key, !p.watched)}
          disabled={!p.steamId}
          title={p.steamId ? '' : 'Cannot watch a player without a Steam ID'}
        >
          {p.watched ? 'Unwatch' : 'Watch player'}
        </button>
        <button className="btn" onClick={refresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
        {p.steamId && (
          <button className="btn" onClick={() => void window.scout.openExternal(s?.profileUrl ?? steamProfileUrl(p.steamId!))}>
            Steam profile
          </button>
        )}
        {f?.profileUrl && (
          <button className="btn" onClick={() => void window.scout.openExternal(f.profileUrl!)}>
            FACEIT profile
          </button>
        )}
        {v?.profileUrl && (
          <button className="btn" onClick={() => void window.scout.openExternal(v.profileUrl!)}>
            Leetify profile
          </button>
        )}
      </div>

      <div className="disclaimer">
        The Suspicion Score measures statistical anomaly against fixed thresholds. It is not evidence of cheating.
      </div>
    </div>
  )
}
