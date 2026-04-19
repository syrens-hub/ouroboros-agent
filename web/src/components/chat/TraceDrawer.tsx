import { X, GitBranch } from 'lucide-react'
import { useChatStore } from '../../store/chatStore'

function formatTime(ts?: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export function TraceDrawer() {
  const { traceDrawerOpen, setTraceDrawerOpen, traceLoading, traceEvents } = useChatStore()
  if (!traceDrawerOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={() => setTraceDrawerOpen(false)} />
      <div className="relative w-[28rem] max-w-full bg-card border-l border-border h-full overflow-y-auto p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-text-strong flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-accent" />
            思维链
          </h3>
          <button onClick={() => setTraceDrawerOpen(false)} className="p-1 rounded hover:bg-secondary transition"><X className="w-4 h-4" /></button>
        </div>
        {traceLoading && <div className="text-xs text-muted">加载中...</div>}
        {!traceLoading && traceEvents.length === 0 && <div className="text-xs text-muted">暂无 trace 记录</div>}
        {!traceLoading && traceEvents.length > 0 && (
          <div className="space-y-4">
            {Object.entries(traceEvents.reduce<Record<string, typeof traceEvents>>((acc, ev) => {
              const k = `Turn ${ev.turn}`
              acc[k] = acc[k] || []
              acc[k].push(ev)
              return acc
            }, {})).map(([turn, items]) => (
              <div key={turn} className="border border-border rounded-lg p-3">
                <div className="text-xs font-semibold text-accent mb-2">{turn}</div>
                <div className="space-y-2">
                  {items.map((ev, i) => (
                    <div key={i} className="text-xs space-y-1">
                      <div className="flex items-center gap-2 text-muted">
                        <span className="px-1.5 py-0.5 rounded bg-secondary text-white text-[10px]">{ev.type}</span>
                        <span className="font-medium">{ev.actor}</span>
                        <span className="ml-auto">{formatTime(ev.timestamp)}</span>
                      </div>
                      {ev.latencyMs != null && <div className="text-[10px] text-muted">latency: {ev.latencyMs}ms{ev.tokens != null ? ` · tokens: ${ev.tokens}` : ''}</div>}
                      {ev.input != null && (
                        <details className="rounded border border-white/5 bg-secondary/30">
                          <summary className="cursor-pointer px-2 py-1 text-[10px] text-muted">input</summary>
                          <pre className="px-2 pb-2 text-[10px] text-muted whitespace-pre-wrap">{typeof ev.input === 'string' ? ev.input : JSON.stringify(ev.input, null, 2)}</pre>
                        </details>
                      )}
                      {ev.output != null && (
                        <details className="rounded border border-white/5 bg-secondary/30">
                          <summary className="cursor-pointer px-2 py-1 text-[10px] text-muted">output</summary>
                          <pre className="px-2 pb-2 text-[10px] text-muted whitespace-pre-wrap">{typeof ev.output === 'string' ? ev.output : JSON.stringify(ev.output, null, 2)}</pre>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
