import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  GitCommit,
  ChevronDown,
  ChevronRight,
  Coins,
  Shield,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  XCircle,
  Clock,
  Filter,
  ChevronUp,
} from 'lucide-react'
import { apiFetch } from '../api'

interface EvolutionCommit {
  hash?: string
  shortHash?: string
  message?: string
  author?: string
  date?: string
  tags?: string[]
  stats?: { filesChanged?: number; insertions?: number; deletions?: number }
}

interface EvolutionMetadata {
  id?: string
  commitHash?: string
  trigger?: string
  costUsd?: number
  reviewerModels?: string[]
  userDecision?: string
  riskLevel?: number
  status?: string
  createdAt?: number
}

interface HistoryItem {
  commit?: EvolutionCommit
  metadata?: EvolutionMetadata
}

interface EvolutionMetrics {
  totalEvolutions?: number
  totalCostUsd?: number
  successRate?: number
  avgRiskLevel?: number
  approvalRate?: number
  rollbackRate?: number
  byTrigger?: Record<string, { count?: number; costUsd?: number }>
  byStatus?: Record<string, number>
  avgCostPerEvolution?: number
  highRiskCount?: number
}

async function fetchEvolutionHistory(): Promise<HistoryItem[]> {
  const res = await apiFetch('/api/evolution/history')
  const data = (await res.json()) as { data?: HistoryItem[] }
  return data.data || []
}

async function fetchEvolutionMetrics(): Promise<EvolutionMetrics | null> {
  try {
    const res = await apiFetch('/api/evolution/metrics')
    const data = (await res.json()) as { data?: EvolutionMetrics }
    return data.data || null
  } catch {
    return null
  }
}

function statusDotColor(status: string): string {
  switch (status) {
    case 'approved':
    case 'completed':
      return 'bg-ok'
    case 'pending':
    case 'running':
      return 'bg-warn'
    case 'rolled_back':
    case 'rejected':
      return 'bg-danger'
    default:
      return 'bg-muted'
  }
}

function statusBorderColor(status: string): string {
  switch (status) {
    case 'approved':
    case 'completed':
      return 'border-ok/30'
    case 'pending':
    case 'running':
      return 'border-warn/30'
    case 'rolled_back':
    case 'rejected':
      return 'border-danger/30'
    default:
      return 'border-white/10'
  }
}

function riskBadge(riskLevel: number): string {
  if (riskLevel >= 8) return 'text-danger bg-danger/10 border-danger/20'
  if (riskLevel >= 5) return 'text-warn bg-warn/10 border-warn/20'
  return 'text-ok bg-ok/10 border-ok/20'
}

export function EvolutionTimeline() {
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['evolution-history'],
    queryFn: fetchEvolutionHistory,
  })
  const { data: metrics } = useQuery({
    queryKey: ['evolution-metrics'],
    queryFn: fetchEvolutionMetrics,
  })

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedAll, setExpandedAll] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [triggerFilter, setTriggerFilter] = useState('all')

  const allStatuses = useMemo(() => {
    const s = new Set<string>()
    history.forEach((item) => {
      const st = item.metadata?.status
      if (st) s.add(st)
    })
    return Array.from(s).sort()
  }, [history])

  const allTriggers = useMemo(() => {
    const t = new Set<string>()
    history.forEach((item) => {
      const tr = item.metadata?.trigger
      if (tr) t.add(tr)
    })
    return Array.from(t).sort()
  }, [history])

  const filtered = useMemo(() => {
    return history.filter((item) => {
      const meta = item.metadata
      if (!meta) return true
      if (statusFilter !== 'all' && meta.status !== statusFilter) return false
      if (triggerFilter !== 'all' && meta.trigger !== triggerFilter) return false
      return true
    })
  }, [history, statusFilter, triggerFilter])

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  const toggleExpandAll = () => {
    setExpandedAll((prev) => !prev)
    setExpandedAll((next) => {
      if (!next) setExpandedId(null)
      return next
    })
  }

  const isExpanded = (id: string) => expandedAll || expandedId === id

  if (isLoading) {
    return (
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="text-sm text-muted">Loading evolution history…</div>
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-strong flex items-center gap-2">
          <GitCommit className="w-4 h-4 text-accent" />
          Evolution Timeline
        </h3>
        <div className="flex items-center gap-2">
          {filtered.length !== history.length && (
            <span className="text-xs text-muted">{filtered.length} / {history.length}</span>
          )}
          <button
            onClick={toggleExpandAll}
            className="text-xs text-muted hover:text-text-strong flex items-center gap-1 px-2 py-1 rounded-md hover:bg-secondary/50 transition-colors"
          >
            {expandedAll ? (
              <>
                <ChevronUp className="w-3 h-3" /> Collapse
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3" /> Expand
              </>
            )}
          </button>
        </div>
      </div>

      {/* Metrics cards */}
      {metrics && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-secondary/20 border border-border rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted mb-1">
              <BarChart3 className="w-3 h-3" />
              Total
            </div>
            <div className="text-lg font-semibold text-text-strong">{metrics.totalEvolutions}</div>
          </div>
          <div className="bg-secondary/20 border border-border rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted mb-1">
              <Coins className="w-3 h-3" />
              Cost
            </div>
            <div className="text-lg font-semibold text-text-strong">${(metrics.totalCostUsd ?? 0).toFixed(4)}</div>
          </div>
          <div className="bg-secondary/20 border border-border rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted mb-1">
              <CheckCircle2 className="w-3 h-3" />
              Success
            </div>
            <div className="text-lg font-semibold text-text-strong">{metrics.successRate}%</div>
          </div>
          <div className="bg-secondary/20 border border-border rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted mb-1">
              <Shield className="w-3 h-3" />
              Avg Risk
            </div>
            <div className="text-lg font-semibold text-text-strong">{metrics.avgRiskLevel}</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="w-3.5 h-3.5 text-muted" />
        <select
          value={statusFilter}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStatusFilter(e.target.value)}
          className="text-xs bg-secondary/30 border border-border rounded-md px-2 py-1 text-text-strong focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="all">All statuses</option>
          {allStatuses.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={triggerFilter}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setTriggerFilter(e.target.value)}
          className="text-xs bg-secondary/30 border border-border rounded-md px-2 py-1 text-text-strong focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="all">All triggers</option>
          {allTriggers.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        {(statusFilter !== 'all' || triggerFilter !== 'all') && (
          <button
            onClick={() => { setStatusFilter('all'); setTriggerFilter('all') }}
            className="text-xs text-muted hover:text-danger flex items-center gap-1"
          >
            <XCircle className="w-3 h-3" /> Clear
          </button>
        )}
      </div>

      {filtered.length === 0 && (
        <div className="text-center text-xs text-muted py-6 bg-secondary/20 border border-border rounded-lg">
          {history.length === 0 ? 'No evolution history yet.' : 'No matches for the selected filters.'}
        </div>
      )}

      <div className="relative pl-4">
        {/* Vertical line */}
        <div className="absolute left-[1.1rem] top-2 bottom-2 w-px bg-border" />

        <div className="space-y-4">
          {filtered.map((item) => {
            const commit = item.commit || (item as unknown as EvolutionCommit)
            const meta = item.metadata
            const id = meta?.id || (commit as EvolutionCommit).shortHash || 'unknown'
            const expanded = isExpanded(id)
            const status = meta?.status || 'pending'

            return (
              <div key={id} className="relative">
                {/* Dot */}
                <div
                  className={`absolute -left-[0.35rem] top-1.5 w-2.5 h-2.5 rounded-full ${statusDotColor(status)} ring-2 ring-card`}
                />

                <div
                  className={`ml-5 bg-secondary/30 border ${statusBorderColor(status)} rounded-lg p-3 cursor-pointer transition-colors hover:bg-secondary/50`}
                  onClick={() => toggleExpand(id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                    if (e.key === 'Enter' || e.key === ' ') toggleExpand(id)
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-accent">{(commit as EvolutionCommit).shortHash}</span>
                      <span className="text-sm text-text-strong truncate max-w-[16rem] sm:max-w-xs">
                        {(commit as EvolutionCommit).message}
                      </span>
                      {meta && (meta.riskLevel ?? 0) > 0 && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${riskBadge(meta.riskLevel ?? 0)}`}>
                          R{meta.riskLevel}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted">{(commit as EvolutionCommit).date?.slice(0, 10)}</span>
                      {expanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-muted" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-muted" />
                      )}
                    </div>
                  </div>

                  {expanded && meta && (
                    <div className="mt-3 pt-3 border-t border-border/60 space-y-2">
                      <div className="flex items-center gap-4 text-xs flex-wrap">
                        <div className="flex items-center gap-1 text-muted">
                          <Coins className="w-3.5 h-3.5" />
                          <span>${meta.costUsd?.toFixed(4) ?? '0.0000'}</span>
                        </div>
                        <div className="flex items-center gap-1 text-muted">
                          <Shield className="w-3.5 h-3.5" />
                          <span>Risk {meta.riskLevel ?? 0}/10</span>
                        </div>
                        <div className="flex items-center gap-1 text-muted">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span className="capitalize">{meta.trigger?.replace('_', ' ')}</span>
                        </div>
                        <div className="flex items-center gap-1 text-muted">
                          <Clock className="w-3.5 h-3.5" />
                          <span className="capitalize">{meta.status}</span>
                        </div>
                      </div>
                      {meta.reviewerModels && meta.reviewerModels.length > 0 && (
                        <div className="text-xs text-muted">
                          Reviewers: {meta.reviewerModels.join(', ')}
                        </div>
                      )}
                      <div className="text-xs text-muted capitalize">
                        Decision: <span className="text-text-strong">{meta.userDecision}</span>
                      </div>
                      {(commit as EvolutionCommit).stats && (
                        <div className="text-xs text-muted">
                          Diff: <span className="text-ok">+{(commit as EvolutionCommit).stats?.insertions}</span>{' '}
                          <span className="text-danger">-{(commit as EvolutionCommit).stats?.deletions}</span>{' '}
                          ({(commit as EvolutionCommit).stats?.filesChanged} files)
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
