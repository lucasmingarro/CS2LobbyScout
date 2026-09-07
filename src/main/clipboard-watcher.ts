import { clipboard } from 'electron'
import { isLikelyStatusOutput, parseStatus } from '@shared/lobby-parser'
import { extractFaceitMatchId } from '@shared/faceit-room'
import { logger } from './logger'

export interface ClipboardDetection {
  kind: 'status' | 'faceit_room'
  raw: string
  playerCount: number
  /** Dedupe hash: the parsed status hash, or the FACEIT match id. */
  rawHash: string
  /** Set when kind is 'faceit_room'. */
  matchId?: string
}

/**
 * Polls the system clipboard and reports text that looks like CS2 `status`
 * output or contains a FACEIT match room URL. Electron has no clipboard
 * change event, so a cheap 1s poll is used.
 */
export class ClipboardWatcher {
  private timer?: NodeJS.Timeout
  private lastText = ''
  private lastHash = ''

  constructor(
    private onDetect: (d: ClipboardDetection) => void,
    private intervalMs = 1000
  ) {}

  start(): void {
    if (this.timer) return
    try {
      this.lastText = clipboard.readText()
    } catch {
      this.lastText = ''
    }
    this.timer = setInterval(() => this.tick(), this.intervalMs)
    logger.debug('clipboard.watch_start')
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    logger.debug('clipboard.watch_stop')
  }

  isRunning(): boolean {
    return !!this.timer
  }

  /** Marks a hash as already handled so the same copy is not offered twice. */
  markHandled(hash: string): void {
    this.lastHash = hash
  }

  private tick(): void {
    let text: string
    try {
      text = clipboard.readText()
    } catch {
      return
    }
    if (text === this.lastText) return
    this.lastText = text
    const matchId = extractFaceitMatchId(text)
    if (matchId) {
      if (matchId === this.lastHash) return
      this.lastHash = matchId
      logger.info('clipboard.detected_faceit_room', { matchId })
      this.onDetect({ kind: 'faceit_room', raw: text, playerCount: 0, rawHash: matchId, matchId })
      return
    }
    if (!isLikelyStatusOutput(text)) return
    const parsed = parseStatus(text)
    if (parsed.rawHash === this.lastHash) return
    this.lastHash = parsed.rawHash
    logger.info('clipboard.detected', { players: parsed.players.length })
    this.onDetect({ kind: 'status', raw: text, playerCount: parsed.players.length, rawHash: parsed.rawHash })
  }
}
