const API_TOKEN = typeof window !== 'undefined' ? (window as unknown as { __OUROBOROS_API_TOKEN__: string }).__OUROBOROS_API_TOKEN__ || '' : ''

export function getApiHeaders(contentType = true): Record<string, string> {
  const headers: Record<string, string> = {}
  if (contentType) headers['Content-Type'] = 'application/json'
  if (API_TOKEN) headers['Authorization'] = `Bearer ${API_TOKEN}`
  return headers
}

export function apiUrl(path: string): string {
  // Token is sent via Authorization header; no longer appended to URL
  return path
}

export function wsUrl(sessionId?: string): { url: string; protocols?: string[] } {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host
  const base = `${protocol}//${host}/ws`
  const params = new URLSearchParams()
  if (sessionId) params.set('sessionId', sessionId)
  const qs = params.toString()
  const url = qs ? `${base}?${qs}` : base
  // Pass token via subprotocol to avoid query-string leakage in logs/referrer
  const protocols = API_TOKEN ? [`ouroboros-token-${API_TOKEN}`] : undefined
  return { url, protocols }
}

async function fetchWithTimeout(path: string, opts: RequestInit = {}, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(path, { ...opts, signal: controller.signal })
    return res
  } finally {
    clearTimeout(id)
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface ApiFetchOptions extends RequestInit {
  maxRetries?: number
  timeoutMs?: number
}

export async function apiFetch(path: string, opts: ApiFetchOptions = {}): Promise<Response> {
  const baseHeaders: Record<string, string> = {}
  if (API_TOKEN) baseHeaders['Authorization'] = `Bearer ${API_TOKEN}`
  if (opts.body != null && !(opts.body instanceof FormData)) {
    baseHeaders['Content-Type'] = 'application/json'
  }
  const headers = new Headers(baseHeaders)
  if (opts.headers) {
    const h = opts.headers
    if (h instanceof Headers) {
      h.forEach((v, k) => headers.set(k, v))
    } else if (Array.isArray(h)) {
      h.forEach(([k, v]) => headers.set(k, v))
    } else {
      Object.entries(h).forEach(([k, v]) => { if (v != null) headers.set(k, v) })
    }
  }
  const maxRetries = opts.maxRetries ?? 2
  const timeoutMs = opts.timeoutMs ?? 10000
  let lastError: unknown
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const res = await fetchWithTimeout(path, { ...opts, headers }, timeoutMs)
      if (res.ok) return res
      // Only retry on 5xx or network errors
      if (res.status < 500) return res
      lastError = new Error(`HTTP ${res.status}`)
    } catch (e) {
      lastError = e
    }
    if (i < maxRetries) {
      await sleep(500 * Math.pow(2, i))
    }
  }
  throw lastError
}
