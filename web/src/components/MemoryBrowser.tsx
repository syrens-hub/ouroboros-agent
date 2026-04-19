import { useState, useEffect, useMemo } from 'react'
import { Brain, Search, Clock, Star, FileText, X, ChevronDown, ChevronUp } from 'lucide-react'
import { apiFetch } from '../api'

const ALL_LAYERS = ['all', 'general', 'learning', 'reflection', 'archive', 'agency', 'competence', 'hil', 'important', 'project', 'pattern'] as const

type Layer = (typeof ALL_LAYERS)[number]

const LAYER_COLORS: Record<string, string> = {
  learning: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  reflection: 'bg-violet-500/15 text-violet-400 border-violet-500/20',
  archive: 'bg-slate-500/15 text-slate-400 border-slate-500/20',
  agency: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  competence: 'bg-sky-500/15 text-sky-400 border-sky-500/20',
  hil: 'bg-rose-500/15 text-rose-400 border-rose-500/20',
  important: 'bg-pink-500/15 text-pink-400 border-pink-500/20',
  project: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20',
  pattern: 'bg-lime-500/15 text-lime-400 border-lime-500/20',
  general: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/20',
}

interface MemoryItem {
  id: string
  layer: string
  content?: string
  summary?: string
  score?: number
  source_path?: string
  updated_at?: number | string
  created_at?: number | string
}

function formatTime(ts: number | string | undefined): string {
  if (!ts) return '-'
  const d = new Date(ts)
  return d.toLocaleString()
}

function truncate(str: string | undefined, max = 240): string {
  if (!str) return ''
  return str.length > max ? str.slice(0, max) + '…' : str
}

export function MemoryBrowser() {
  const [query, setQuery] = useState('')
  const [activeLayer, setActiveLayer] = useState<Layer>('all')
  const [items, setItems] = useState<MemoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      let res: Response
      if (query.trim()) {
        res = await apiFetch(`/api/memory/search?q=${encodeURIComponent(query.trim())}&limit=50`)
      } else {
        const layersParam = activeLayer !== 'all' ? `&layers=${encodeURIComponent(activeLayer)}` : ''
        res = await apiFetch(`/api/memory/layers?limit=50${layersParam}`)
      }
      const json = (await res.json()) as { success: boolean; data?: MemoryItem[]; error?: { message?: string } | string }
      if (json.success) {
        setItems(json.data || [])
      } else {
        setError(typeof json.error === 'string' ? json.error : json.error?.message || String(json.error))
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLayer])

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    fetchData()
  }

  const filteredItems = useMemo(() => {
    // When searching, backend already filters; when on a specific layer, backend also filters.
    // This is mainly for safety.
    return items
  }, [items])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="glass-strong rounded-xl p-4 border border-white/[0.06]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent)' }}>
              <Brain className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-strong)' }}>记忆层</h2>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                浏览、搜索从 OpenClaw 迁移而来的多层记忆 ({filteredItems.length} 条)
              </p>
            </div>
          </div>

          <form onSubmit={handleSearch} className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--muted)' }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索记忆内容..."
                className="pl-9 pr-8 py-2 rounded-lg text-sm bg-white/[0.04] border border-white/[0.08] focus:outline-none focus:border-accent/50 w-64"
                style={{ color: 'var(--text)' }}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => { setQuery(''); fetchData() }}
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                >
                  <X className="w-3.5 h-3.5" style={{ color: 'var(--muted)' }} />
                </button>
              )}
            </div>
            <button
              type="submit"
              disabled={loading}
              className="px-3 py-2 rounded-lg text-sm font-medium transition hover:opacity-90 disabled:opacity-50"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              {loading ? '搜索中…' : '搜索'}
            </button>
          </form>
        </div>

        {/* Layer filters */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {ALL_LAYERS.map((layer) => {
            const active = activeLayer === layer
            return (
              <button
                key={layer}
                onClick={() => { setActiveLayer(layer); setQuery('') }}
                className={`px-2.5 py-1 rounded-md text-xs border transition ${active ? 'bg-white/10 border-white/20 text-white' : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/5'}`}
                style={{ color: active ? '#fff' : 'var(--muted)' }}
              >
                {layer === 'all' ? '全部' : layer}
              </button>
            )
          })}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl p-4 border" style={{ background: 'var(--danger-subtle)', borderColor: 'rgba(239,68,68,0.25)', color: 'var(--danger)' }}>
          加载失败: {error}
        </div>
      )}

      {/* List */}
      <div className="grid gap-3">
        {filteredItems.length === 0 && !loading && (
          <div className="glass rounded-xl p-10 text-center border border-white/[0.06]" style={{ color: 'var(--muted)' }}>
            暂无记忆条目
          </div>
        )}

        {filteredItems.map((item) => {
          const isExpanded = expandedId === item.id
          const layerCls = LAYER_COLORS[item.layer] || LAYER_COLORS.general
          return (
            <div
              key={item.id}
              className="glass rounded-xl p-4 border border-white/[0.06] hover:border-white/[0.10] transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${layerCls}`}>
                    {item.layer}
                  </span>
                  {item.score != null && (
                    <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--muted)' }}>
                      <Star className="w-3 h-3" />
                      {Number(item.score).toFixed(2)}
                    </span>
                  )}
                  {item.source_path && (
                    <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--muted)' }}>
                      <FileText className="w-3 h-3" />
                      <span className="max-w-[16rem] truncate">{item.source_path}</span>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[10px] shrink-0" style={{ color: 'var(--muted)' }}>
                  <Clock className="w-3 h-3" />
                  <span>{formatTime(item.updated_at || item.created_at)}</span>
                </div>
              </div>

              <div className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--text)' }}>
                {isExpanded ? (
                  <pre className="whitespace-pre-wrap font-sans">{item.content}</pre>
                ) : (
                  <div>{truncate(item.content, 360)}</div>
                )}
              </div>

              {item.summary && (
                <div className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
                  <span className="font-medium" style={{ color: 'var(--text-strong)' }}>摘要:</span> {item.summary}
                </div>
              )}

              {item.content && item.content.length > 360 && (
                <button
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                  className="mt-2 flex items-center gap-1 text-xs hover:underline"
                  style={{ color: 'var(--accent)' }}
                >
                  {isExpanded ? (
                    <>
                      <ChevronUp className="w-3.5 h-3.5" /> 收起
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3.5 h-3.5" /> 展开全文
                    </>
                  )}
                </button>
              )}
            </div>
          )
        })}

        {loading && (
          <div className="py-6 text-center text-sm" style={{ color: 'var(--muted)' }}>
            加载中…
          </div>
        )}
      </div>
    </div>
  )
}
