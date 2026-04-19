import { useEffect } from 'react'
import { MessageSquare, Plus, Trash2, Loader2 } from 'lucide-react'
import { useSessionStore } from '../../store/sessionStore'

export function SessionSidebar() {
  const { sessions, currentSessionId, fetchSessions, createSession, switchSession, deleteSession, isCreating } = useSessionStore()

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  return (
    <div className="w-64 flex-shrink-0 bg-card border border-border rounded-xl p-4 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-text-strong flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-accent" />
          会话
        </h3>
        <button
          onClick={() => createSession()}
          disabled={isCreating}
          className="p-1.5 rounded-lg bg-secondary hover:bg-secondary/70 transition hover:scale-105 active:scale-95 disabled:opacity-50"
          title="新建会话"
        >
          {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
        {sessions.map((s) => (
          <div
            key={s.sessionId}
            onClick={() => switchSession(s.sessionId)}
            className={`group cursor-pointer px-3 py-2.5 rounded-lg text-sm transition-all duration-200 flex items-center justify-between ${
              s.sessionId === currentSessionId
                ? 'bg-accent text-white shadow-md shadow-accent/20'
                : 'hover:bg-white/5 hover:translate-x-0.5 hover:shadow-sm'
            }`}
          >
            <span className="truncate flex-1">{s.title || s.sessionId}</span>
            <button
              onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.stopPropagation()
                deleteSession(s.sessionId)
              }}
              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-danger/20 text-danger transition"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
        {sessions.length === 0 && <div className="text-xs text-muted text-center py-8">暂无会话</div>}
      </div>
    </div>
  )
}
