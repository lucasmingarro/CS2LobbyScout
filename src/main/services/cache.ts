/** Minimal cache interface so clients can be tested without SQLite. */
export interface CacheStore {
  get<T>(key: string): T | undefined
  set(key: string, value: unknown, ttlMs: number): void
  deleteByPrefix(prefix: string): void
}

export const TTL = {
  steamProfile: 24 * 60 * 60 * 1000,
  steamBans: 6 * 60 * 60 * 1000,
  steamGames: 24 * 60 * 60 * 1000,
  faceitProfile: 6 * 60 * 60 * 1000,
  faceitStats: 60 * 60 * 1000,
  /** Negative FACEIT lookups (no account) are cached shorter so new accounts show up. */
  faceitNotFound: 2 * 60 * 60 * 1000
} as const

export class MemoryCache implements CacheStore {
  private map = new Map<string, { value: unknown; expiresAt: number }>()
  get<T>(key: string): T | undefined {
    const e = this.map.get(key)
    if (!e) return undefined
    if (e.expiresAt <= Date.now()) {
      this.map.delete(key)
      return undefined
    }
    return e.value as T
  }
  set(key: string, value: unknown, ttlMs: number): void {
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs })
  }
  deleteByPrefix(prefix: string): void {
    for (const k of [...this.map.keys()]) if (k.startsWith(prefix)) this.map.delete(k)
  }
}
