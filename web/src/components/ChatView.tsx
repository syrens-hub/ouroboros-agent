import { useEffect } from 'react'
import { wsUrl } from '../api'
import { useSessionStore } from '../store/sessionStore'
import { useChatStore } from '../store/chatStore'
import { SessionSidebar } from './chat/SessionSidebar'
import { MessageList } from './chat/MessageList'
import { MessageInput } from './chat/MessageInput'
import { SkillPanel } from './chat/SkillPanel'
import { TypingIndicator } from './chat/TypingIndicator'
import { Lightbox } from './chat/Lightbox'
import { ConfirmModal } from './chat/ConfirmModal'
import { TraceDrawer } from './chat/TraceDrawer'
import type { SystemStatus } from '../types/chat'

interface ChatViewProps {
  systemStatus?: SystemStatus
}

export function ChatView({ systemStatus }: ChatViewProps) {
  const { error, skillPanelOpen, addReviewNotice, setReviewNotices } = useChatStore()
  const { currentSessionId } = useSessionStore()

  // Listen to WebSocket for background review decisions on the active session
  useEffect(() => {
    if (!currentSessionId) {
      setReviewNotices([])
      return
    }
    const { url, protocols } = wsUrl(currentSessionId)
    const ws = new WebSocket(url, protocols)
    ws.onmessage = (e) => {
      try {
        const { event, data } = JSON.parse(e.data) as { event: string; data: Record<string, unknown> }
        if (
          event === 'notification' &&
          data.type === 'review_decision' &&
          (data.meta as Record<string, string>)?.sessionId === currentSessionId
        ) {
          const id = Date.now() + Math.random()
          addReviewNotice({ id, ...data } as import('../types/chat').ReviewNotice)
        }
      } catch {
        // ignore
      }
    }
    return () => ws.close()
  }, [currentSessionId, addReviewNotice, setReviewNotices])

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      <Lightbox />
      <SessionSidebar />
      <div className="flex-1 flex flex-col">
        <MessageList />
        {error && <div className="text-red-500 p-2">{error}</div>}
        <TypingIndicator />
        <MessageInput />
      </div>
      {skillPanelOpen && <SkillPanel systemStatus={systemStatus} />}
      <ConfirmModal />
      <TraceDrawer />
    </div>
  )
}
