import { appendFileSync, existsSync, mkdirSync, statSync, renameSync } from 'node:fs'
import { join } from 'node:path'

type Level = 'debug' | 'info' | 'warn' | 'error'

let logDir: string | undefined
let debugEnabled = false
let sink: ((line: string) => void) | undefined
const SECRET_RE = /(key|token|authorization)=([^\s]+)/gi
const MAX_LOG_BYTES = 2 * 1024 * 1024

export function initLogger(dir: string, options: { debug?: boolean; sink?: (line: string) => void } = {}): void {
  logDir = dir
  debugEnabled = !!options.debug
  sink = options.sink
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function setDebug(enabled: boolean): void {
  debugEnabled = enabled
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function timestamp(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatFields(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ')
}

function rotateIfNeeded(file: string): void {
  try {
    if (existsSync(file) && statSync(file).size > MAX_LOG_BYTES) renameSync(file, `${file}.1`)
  } catch {
    /* ignore */
  }
}

export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  if (level === 'debug' && !debugEnabled) return
  const line = `${timestamp()} ${level.padEnd(5)} ${event.padEnd(20)} ${formatFields(fields)}`
    .replace(SECRET_RE, '$1=***')
    .trimEnd()
  if (level === 'error' || level === 'warn') console.error(line)
  else console.log(line)
  sink?.(line)
  if (logDir) {
    const file = join(logDir, 'app.log')
    try {
      rotateIfNeeded(file)
      appendFileSync(file, line + '\n')
    } catch {
      /* ignore disk errors */
    }
  }
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) => log('debug', event, fields),
  info: (event: string, fields?: Record<string, unknown>) => log('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => log('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => log('error', event, fields)
}

export function errorFields(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { error: err.message }
  return { error: String(err) }
}
