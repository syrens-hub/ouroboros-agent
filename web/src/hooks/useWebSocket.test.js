import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWebSocket } from './useWebSocket.js'

class MockWebSocket {
  static instances = []
  static OPEN = 1
  static CLOSED = 3
  constructor(url) {
    this.url = url
    this.readyState = MockWebSocket.OPEN
    MockWebSocket.instances.push(this)
  }
  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = 3 // CLOSED
    if (this.onclose) this.onclose()
  })
}

describe('useWebSocket', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', MockWebSocket)
    vi.stubGlobal('location', { protocol: 'https:', host: 'example.com' })
  })

  afterEach(() => {
    MockWebSocket.instances = []
    vi.unstubAllGlobals()
  })

  it('connects and calls handlers', () => {
    const { result } = renderHook(() => useWebSocket())
    const handlers = { onOpen: vi.fn(), onEvent: vi.fn(), onError: vi.fn(), onClose: vi.fn() }

    act(() => {
      result.current.connect('session-1', handlers)
    })

    const ws = MockWebSocket.instances[0]
    expect(ws.url).toContain('wss://example.com/ws')
    expect(ws.url).toContain('sessionId=session-1')

    act(() => {
      ws.onopen()
    })
    expect(handlers.onOpen).toHaveBeenCalled()

    act(() => {
      ws.onmessage({ data: JSON.stringify({ event: 'assistant', data: { content: 'hi' } }) })
    })
    expect(handlers.onEvent).toHaveBeenCalledWith({ event: 'assistant', content: 'hi' })
  })

  it('sends messages when open', () => {
    const { result } = renderHook(() => useWebSocket())
    act(() => {
      result.current.connect('s1', {})
    })
    const ws = MockWebSocket.instances[0]
    act(() => {
      result.current.send({ type: 'chat', message: 'hello' })
    })
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'chat', message: 'hello' }))
  })

  it('does not send when closed', () => {
    const { result } = renderHook(() => useWebSocket())
    act(() => {
      result.current.connect('s1', {})
    })
    const ws = MockWebSocket.instances[0]
    ws.readyState = 3
    act(() => {
      result.current.send({ type: 'chat', message: 'hello' })
    })
    expect(ws.send).not.toHaveBeenCalled()
  })

  it('closes connection', () => {
    const { result } = renderHook(() => useWebSocket())
    act(() => {
      result.current.connect('s1', {})
    })
    const ws = MockWebSocket.instances[0]
    act(() => {
      result.current.close()
    })
    expect(ws.close).toHaveBeenCalled()
  })
})
