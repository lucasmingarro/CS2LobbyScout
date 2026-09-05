import { logger } from '../logger'

export type ApiErrorKind = 'not_found' | 'unauthorized' | 'rate_limited' | 'server' | 'network' | 'bad_request'

export class ApiError extends Error {
  constructor(
    public kind: ApiErrorKind,
    message: string,
    public status?: number
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface RequestManagerOptions {
  /** Max concurrent in-flight requests per host. */
  concurrencyPerHost?: number
  /** Retries for 429 / 5xx / network errors. */
  retries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  timeoutMs?: number
  fetchImpl?: typeof fetch
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>
}

interface HostState {
  active: number
  queue: Array<() => void>
  /** Timestamp until which the host is considered rate limited (after a 429). */
  blockedUntil: number
}

/**
 * Single funnel for every outbound API call:
 *  - per-host concurrency limit
 *  - in-flight de-duplication by key
 *  - retry with exponential backoff (honours Retry-After on 429)
 *  - host-wide cool down after a 429 so parallel requests do not pile on
 */
export class RequestManager {
  private hosts = new Map<string, HostState>()
  private inflight = new Map<string, Promise<unknown>>()
  private opts: Required<RequestManagerOptions>

  constructor(options: RequestManagerOptions = {}) {
    this.opts = {
      concurrencyPerHost: options.concurrencyPerHost ?? 4,
      retries: options.retries ?? 3,
      baseDelayMs: options.baseDelayMs ?? 500,
      maxDelayMs: options.maxDelayMs ?? 15_000,
      timeoutMs: options.timeoutMs ?? 15_000,
      fetchImpl: options.fetchImpl ?? fetch,
      sleep: options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    }
  }

  /** Performs a JSON GET. `key` de-duplicates identical concurrent requests. */
  getJson<T>(key: string, url: string, init: RequestInit = {}): Promise<T> {
    const existing = this.inflight.get(key)
    if (existing) return existing as Promise<T>
    const p = this.run<T>(url, init).finally(() => this.inflight.delete(key))
    this.inflight.set(key, p)
    return p
  }

  private hostState(url: string): HostState {
    const host = new URL(url).host
    let st = this.hosts.get(host)
    if (!st) {
      st = { active: 0, queue: [], blockedUntil: 0 }
      this.hosts.set(host, st)
    }
    return st
  }

  private acquire(st: HostState): Promise<void> {
    if (st.active < this.opts.concurrencyPerHost) {
      st.active++
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      st.queue.push(() => {
        st.active++
        resolve()
      })
    })
  }

  private release(st: HostState): void {
    st.active--
    const next = st.queue.shift()
    if (next) next()
  }

  private async run<T>(url: string, init: RequestInit): Promise<T> {
    const st = this.hostState(url)
    const host = new URL(url).host
    for (let attempt = 0; ; attempt++) {
      const wait = st.blockedUntil - Date.now()
      if (wait > 0) await this.opts.sleep(wait)
      await this.acquire(st)
      let delay: number
      try {
        return await this.once<T>(url, init)
      } catch (err) {
        const apiErr = err as ApiError & { retryAfterMs?: number }
        const retryable =
          apiErr instanceof ApiError &&
          (apiErr.kind === 'rate_limited' || apiErr.kind === 'server' || apiErr.kind === 'network')
        if (!retryable || attempt >= this.opts.retries) throw err
        const backoff = Math.min(this.opts.maxDelayMs, this.opts.baseDelayMs * 2 ** attempt) + Math.random() * 200
        delay = apiErr.retryAfterMs ?? backoff
        if (apiErr.kind === 'rate_limited') st.blockedUntil = Math.max(st.blockedUntil, Date.now() + delay)
        logger.warn('http.retry', { host, attempt: attempt + 1, delayMs: Math.round(delay), kind: apiErr.kind })
      } finally {
        this.release(st)
      }
      await this.opts.sleep(delay)
    }
  }

  private async once<T>(url: string, init: RequestInit): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs)
    let res: Response
    try {
      res = await this.opts.fetchImpl(url, { ...init, signal: controller.signal })
    } catch (err) {
      throw new ApiError('network', `Network error: ${(err as Error).message}`)
    } finally {
      clearTimeout(timer)
    }
    if (res.ok) {
      try {
        return (await res.json()) as T
      } catch (err) {
        throw new ApiError('server', `Invalid JSON: ${(err as Error).message}`, res.status)
      }
    }
    const status = res.status
    let kind: ApiErrorKind = 'server'
    if (status === 404) kind = 'not_found'
    else if (status === 401 || status === 403) kind = 'unauthorized'
    else if (status === 429) kind = 'rate_limited'
    else if (status >= 400 && status < 500) kind = 'bad_request'
    const err = new ApiError(kind, `HTTP ${status} for ${new URL(url).host}`, status) as ApiError & { retryAfterMs?: number }
    const ra = res.headers.get('retry-after')
    if (ra) {
      const secs = Number(ra)
      if (!Number.isNaN(secs)) err.retryAfterMs = secs * 1000
      else {
        const t = Date.parse(ra)
        if (!Number.isNaN(t)) err.retryAfterMs = Math.max(0, t - Date.now())
      }
    }
    throw err
  }
}
