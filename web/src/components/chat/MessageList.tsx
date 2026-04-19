import { useEffect, useRef } from 'react'
import { Loader2, Volume2, GitBranch, Sparkles, X, Cpu } from 'lucide-react'
import { useSessionStore } from '../../store/sessionStore'
import { useChatStore } from '../../store/chatStore'
import { MessageContent } from './MessageContent'

function formatTime(ts?: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function classForRole(role: string): string {
  if (role === 'user')
    return 'bg-gradient-to-br from-accent/30 to-accent/10 text-white border border-accent/30 shadow-lg shadow-accent/10'
  if (role === 'assistant')
    return 'bg-gradient-to-br from-card to-secondary/30 border border-white/10 shadow-[0_4px_24px_rgba(0,0,0,0.35)]'
  if (role === 'tool_result') return 'bg-secondary/30 text-muted border border-white/5'
  if (role === 'computer_use') return 'bg-secondary/20 border border-accent/20'
  return 'bg-card border border-border'
}

export function MessageList() {
  const {
    messages,
    isLoading,
    reviewNotices,
    lightboxUrl,
    ttsSpeakingId,
    hasMore,
    loadingMore,
    setLightboxUrl,
    speakText,
    stopSpeaking,
    setTraceDrawerOpen,
    loadTraces,
    loadSessionHistory,
    loadMoreMessages,
    dismissReviewNotice,
  } = useChatStore()

  const { currentSessionId, sessions } = useSessionStore()
  const activeSession = sessions.find((s) => s.sessionId === currentSessionId)
  const bottomRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  // Load messages when switching session
  useEffect(() => {
    loadSessionHistory(currentSessionId || '')
  }, [currentSessionId, loadSessionHistory])

  // Message pagination on scroll-up
  useEffect(() => {
    const el = messagesContainerRef.current
    if (!el) return
    const onScroll = () => {
      if (el.scrollTop < 50 && hasMore && !loadingMore) {
        loadMoreMessages()
      }
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [hasMore, loadingMore, loadMoreMessages])

  // Lightbox Escape handler
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setLightboxUrl(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setLightboxUrl])

  return (
    <div className="flex-1 bg-card border border-border rounded-xl flex flex-col overflow-hidden relative">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between bg-card/80 backdrop-blur-sm z-10">
        <h2 className="text-sm font-semibold text-text-strong">
          {activeSession ? activeSession.title || activeSession.sessionId : '选择一个会话'}
        </h2>
        {isLoading && <Loader2 className="w-4 h-4 animate-spin text-accent" />}
      </div>

      {reviewNotices.length > 0 && (
        <div className="px-5 pt-3 space-y-2">
          {reviewNotices.map((n) => (
            <div
              key={n.id}
              className="review-banner relative flex items-start gap-3 rounded-xl px-4 py-3 text-sm animate-glow-pulse"
            >
              <div className="relative">
                <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-accent animate-star-pulse" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white tracking-tight">{n.title}</span>
                  {n.meta?.action && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-white/10 text-white border border-white/10">
                      {n.meta.action}
                    </span>
                  )}
                </div>
                {n.message && <div className="text-sm text-white/80 mt-0.5">{n.message}</div>}
              </div>
              <button
                onClick={() => dismissReviewNotice(n.id)}
                className="text-white/60 hover:text-white transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div ref={messagesContainerRef} data-testid="messages-container" className="flex-1 overflow-y-auto p-5 space-y-4">
        {!currentSessionId && (
          <div className="h-full flex flex-col items-center justify-center text-muted">
            <Cpu className="w-12 h-12 mb-4 text-accent/50 animate-float" />
            <p>选择或创建一个会话开始对话</p>
          </div>
        )}
        {messages.map((m, idx) => (
          <div
            key={idx}
            className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm whitespace-pre-wrap animate-fade-in ${classForRole(m.role)} ${m.role === 'user' ? 'ml-auto rounded-br-md' : 'mr-auto rounded-bl-md'}`}
          >
            <div className={`flex items-center gap-2 mb-1.5 text-xs ${m.role === 'user' ? 'text-white/70' : 'text-muted'}`}>
              <span className="font-medium">{m.role === 'user' ? '你' : m.role === 'assistant' ? 'Ouroboros' : m.role === 'computer_use' ? 'Browser' : '工具'}</span>
              <span>{formatTime(m.timestamp)}</span>
              {m.role === 'assistant' && (
                <>
                  <button
                    onClick={() => {
                      if (ttsSpeakingId === idx) {
                        stopSpeaking()
                      } else {
                        const text = (typeof m.content === 'string' ? m.content : '')
                          .replace(/\[Image:.*?\]/g, '')
                          .replace(/!\[.*?\]\(.*?\)/g, '')
                          .replace(/\[附件:.*?\]\(.*?\)/g, '')
                        speakText(text.slice(0, 500), idx)
                      }
                    }}
                    className={`ml-1 p-0.5 rounded transition ${ttsSpeakingId === idx ? 'text-accent animate-pulse' : 'hover:text-accent'}`}
                    title="朗读"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => { setTraceDrawerOpen(true); loadTraces(currentSessionId || '') }}
                    className="ml-1 p-0.5 rounded transition hover:text-accent"
                    title="思维链"
                  >
                    <GitBranch className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
            <MessageContent msg={m} onImageClick={setLightboxUrl} />
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
