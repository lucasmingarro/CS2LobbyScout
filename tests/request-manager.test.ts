import { describe, expect, it, vi } from 'vitest'
import { ApiError, RequestManager } from '../src/main/services/request-manager'

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

describe('RequestManager', () => {
  it('parses json and de-duplicates concurrent requests with the same key', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: 1 }))
    const rm = new RequestManager({ fetchImpl, sleep: async () => {} })
    const [a, b] = await Promise.all([rm.getJson('k', 'https://x.test/a'), rm.getJson('k', 'https://x.test/a')])
    expect(a).toEqual({ ok: 1 })
    expect(b).toEqual({ ok: 1 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('retries 429 honouring Retry-After and 5xx with backoff', async () => {
    const sleeps: number[] = []
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls++
      if (calls === 1) return jsonResponse({}, 429, { 'retry-after': '2' })
      if (calls === 2) return jsonResponse({}, 503)
      return jsonResponse({ done: true })
    })
    const rm = new RequestManager({ fetchImpl, retries: 3, baseDelayMs: 100, sleep: async (ms) => void sleeps.push(ms) })
    const res = await rm.getJson('k', 'https://x.test/a')
    expect(res).toEqual({ done: true })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleeps[0]).toBe(2000)
    expect(sleeps.length).toBeGreaterThanOrEqual(2)
  })

  it('does not retry 404 / 401 and classifies errors', async () => {
    const f404 = vi.fn(async () => jsonResponse({}, 404))
    const rm = new RequestManager({ fetchImpl: f404, sleep: async () => {} })
    await expect(rm.getJson('a', 'https://x.test/a')).rejects.toMatchObject({ kind: 'not_found', status: 404 })
    expect(f404).toHaveBeenCalledTimes(1)

    const f401 = vi.fn(async () => jsonResponse({}, 401))
    const rm2 = new RequestManager({ fetchImpl: f401, sleep: async () => {} })
    await expect(rm2.getJson('b', 'https://x.test/b')).rejects.toBeInstanceOf(ApiError)
    expect(f401).toHaveBeenCalledTimes(1)
  })

  it('gives up after the configured retries', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500))
    const rm = new RequestManager({ fetchImpl, retries: 2, sleep: async () => {} })
    await expect(rm.getJson('k', 'https://x.test/a')).rejects.toMatchObject({ kind: 'server' })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('limits concurrency per host', async () => {
    let active = 0
    let maxActive = 0
    const fetchImpl = vi.fn(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return jsonResponse({})
    })
    const rm = new RequestManager({ fetchImpl, concurrencyPerHost: 2 })
    await Promise.all(Array.from({ length: 8 }, (_, i) => rm.getJson(`k${i}`, `https://x.test/${i}`)))
    expect(maxActive).toBe(2)
    expect(fetchImpl).toHaveBeenCalledTimes(8)
  })

  it('wraps network failures', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET')
    })
    const rm = new RequestManager({ fetchImpl, retries: 0 })
    await expect(rm.getJson('k', 'https://x.test/a')).rejects.toMatchObject({ kind: 'network' })
  })
})
