import { useCallback, useRef } from 'react'
import { wsUrl } from '../api.ts'

interface Handlers {
  onOpen?: () => void
  onEvent?: (data: Record<string, unknown>) => void
  onError?: (err: Event) => void
  onClose?: () => void
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)

  const close = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
  }, [])

  const connect = useCallback((sessionId: string | undefined, handlers: Handlers) => {
    close()
    const { url, protocols } = wsUrl(sessionId)
    const ws = new WebSocket(url, protocols)
    wsRef.current = ws

    ws.onopen = () => {
      handlers.onOpen?.()
    }

    ws.onmessage = (e) => {
      try {
        const { event, data } = JSON.parse(e.data) as { event: string; data: unknown }
        handlers.onEvent?.({ event, ...((typeof data === 'object' && data !== null) ? data as Record<string, unknown> : {}) })
      } catch {
        handlers.onEvent?.({ event: 'raw', data: e.data })
      }
    }

    ws.onerror = (err) => {
      handlers.onError?.(err)
      close()
    }

    ws.onclose = () => {
      handlers.onClose?.()
    }

    return () => close()
  }, [close])

  const send = useCallback((msg: unknown) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  return { connect, close, send }
}
