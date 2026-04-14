import { useCallback, useRef } from 'react'
import { wsUrl } from '../api.js'

export function useWebSocket() {
  const wsRef = useRef(null)

  const close = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
  }, [])

  const connect = useCallback((sessionId, handlers) => {
    close()
    const url = wsUrl(sessionId)
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      handlers.onOpen?.()
    }

    ws.onmessage = (e) => {
      try {
        const { event, data } = JSON.parse(e.data)
        handlers.onEvent?.({ event, ...data })
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

  const send = useCallback((msg) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  return { connect, close, send }
}
