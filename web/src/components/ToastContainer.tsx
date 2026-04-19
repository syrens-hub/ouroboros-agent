import { useEffect, useState } from 'react'
import { Sparkles, Wrench, Info, X } from 'lucide-react'
import { wsUrl } from '../api'

interface ToastItem {
  id: number
  type?: string
  title?: string
  message?: string
  meta?: {
    action?: string
  }
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    const ws = new WebSocket(wsUrl())
    ws.onmessage = (e) => {
      try {
        const { event, data } = JSON.parse(e.data)
        if (event !== 'notification') return
        const id = Date.now() + Math.random()
        setToasts((prev) => [...prev, { id, ...data }])
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id))
        }, 6000)
      } catch {
        // ignore
      }
    }
    return () => ws.close()
  }, [])

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-3 w-80">
      {toasts.map((t) => {
        const isReview = t.type === 'review_decision'
        return (
          <div
            key={t.id}
            className={[
              'relative overflow-hidden rounded-xl p-4 shadow-2xl transition',
              isReview
                ? 'bg-gradient-to-br from-indigo-500/20 via-purple-500/20 to-pink-500/20 border border-white/10 animate-glow-pulse'
                : 'bg-card border border-border',
            ].join(' ')}
          >
            {isReview && (
              <div className="pointer-events-none absolute inset-0 opacity-30">
                <div className="absolute -top-6 -right-6 h-16 w-16 rounded-full blur-2xl bg-accent" />
                <div className="absolute -bottom-6 -left-6 h-16 w-16 rounded-full blur-2xl bg-pink-500" />
              </div>
            )}
            <div className="relative flex items-start gap-3">
              <div className="mt-0.5">
                {t.type === 'skill_learned' && <Sparkles className="w-4 h-4 text-accent" />}
                {t.type === 'daemon_decision' && <Wrench className="w-4 h-4 text-warn" />}
                {t.type === 'review_decision' && <Sparkles className="w-5 h-5 text-white animate-star-pulse" />}
                {t.type === 'system' && <Info className="w-4 h-4 text-info" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`flex items-center gap-2 mb-0.5 ${isReview ? '' : ''}`}>
                  <div className={`font-bold text-white ${isReview ? 'text-base' : 'text-sm'}`}>{t.title}</div>
                  {isReview && t.meta?.action && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-white/15 text-white border border-white/10">
                      {t.meta.action}
                    </span>
                  )}
                  {isReview && (
                    <span className="px-1 py-0 rounded text-[9px] font-bold uppercase tracking-wide bg-accent text-white">
                      New
                    </span>
                  )}
                </div>
                <div className={`leading-relaxed ${isReview ? 'text-sm text-white/90' : 'text-xs text-muted'}`}>{t.message}</div>
              </div>
              <button
                onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                className="text-white/60 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
