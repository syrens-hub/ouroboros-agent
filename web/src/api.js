const API_TOKEN = typeof window !== 'undefined' ? window.__OUROBOROS_API_TOKEN__ || '' : ''

export function getApiHeaders(contentType = true) {
  const headers = {}
  if (contentType) headers['Content-Type'] = 'application/json'
  if (API_TOKEN) headers['Authorization'] = `Bearer ${API_TOKEN}`
  return headers
}

export function apiUrl(path) {
  // Token is sent via Authorization header; no longer appended to URL
  return path
}

export function wsUrl(sessionId) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host
  const base = `${protocol}//${host}/ws`
  const params = new URLSearchParams()
  if (API_TOKEN) params.set('token', API_TOKEN)
  if (sessionId) params.set('sessionId', sessionId)
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}

async function fetchWithTimeout(path, opts = {}, timeoutMs = 10000) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(path, { ...opts, signal: controller.signal })
    return res
  } finally {
    clearTimeout(id)
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function apiFetch(path, opts = {}) {
  const baseHeaders = {}
  if (API_TOKEN) baseHeaders['Authorization'] = `Bearer ${API_TOKEN}`
  if (opts.body != null && !(opts.body instanceof FormData)) {
    baseHeaders['Content-Type'] = 'application/json'
  }
  const headers = { ...baseHeaders, ...(opts.headers || {}) }
  // Strip undefined/null headers so FormData can use native boundary
  Object.keys(headers).forEach((k) => { if (headers[k] == null) delete headers[k] })
  const maxRetries = opts.maxRetries ?? 2
  const timeoutMs = opts.timeoutMs ?? 10000
  let lastError
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
