import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('api.js', () => {
  let api

  beforeEach(async () => {
    vi.stubGlobal('window', {
      __OUROBOROS_API_TOKEN__: 'test-token-123',
      location: { protocol: 'https:', host: 'example.com' },
    })
    // Re-import to pick up the stubbed global
    api = await import('./api.js')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  describe('getApiHeaders', () => {
    it('includes Content-Type and Authorization when token exists', () => {
      const headers = api.getApiHeaders(true)
      expect(headers['Content-Type']).toBe('application/json')
      expect(headers['Authorization']).toBe('Bearer test-token-123')
    })

    it('omits Content-Type when false', () => {
      const headers = api.getApiHeaders(false)
      expect(headers['Content-Type']).toBeUndefined()
      expect(headers['Authorization']).toBe('Bearer test-token-123')
    })
  })

  describe('apiUrl', () => {
    it('returns path without appending token to query string', () => {
      expect(api.apiUrl('/api/status')).toBe('/api/status')
    })

    it('preserves existing query string without appending token', () => {
      expect(api.apiUrl('/api/status?foo=1')).toBe('/api/status?foo=1')
    })
  })

  describe('wsUrl', () => {
    it('builds wss url with token and sessionId', () => {
      const result = api.wsUrl('sess-1')
      expect(result.url).toBe('wss://example.com/ws?sessionId=sess-1')
      expect(result.protocols).toEqual(['ouroboros-token-test-token-123'])
    })

    it('builds wss url without sessionId', () => {
      const result = api.wsUrl()
      expect(result.url).toBe('wss://example.com/ws')
      expect(result.protocols).toEqual(['ouroboros-token-test-token-123'])
    })
  })

  describe('apiFetch', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn())
    })

    it('returns ok response immediately', async () => {
      fetch.mockResolvedValueOnce({ ok: true, status: 200 })
      const res = await api.apiFetch('/api/test')
      expect(res.ok).toBe(true)
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('does not retry on 4xx errors', async () => {
      fetch.mockResolvedValueOnce({ ok: false, status: 404 })
      const res = await api.apiFetch('/api/test')
      expect(res.status).toBe(404)
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('retries on 5xx then succeeds', async () => {
      fetch
        .mockResolvedValueOnce({ ok: false, status: 502 })
        .mockResolvedValueOnce({ ok: true, status: 200 })
      const res = await api.apiFetch('/api/test', { maxRetries: 1 })
      expect(res.ok).toBe(true)
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('retries on network error then throws', async () => {
      fetch.mockRejectedValue(new Error('net error'))
      await expect(api.apiFetch('/api/test', { maxRetries: 0 })).rejects.toThrow('net error')
      expect(fetch).toHaveBeenCalledTimes(1)
    })
  })
})
