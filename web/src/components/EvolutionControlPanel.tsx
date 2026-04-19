import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { GitBranch, CheckCircle, XCircle, RotateCcw, Clock, Shield, AlertTriangle } from 'lucide-react'
import { apiFetch } from '../api'

interface Approval {
  id: string
  status: string
  description?: string
  versionId?: string
  decision?: string
  riskScore?: number
  filesChanged?: string[]
}

interface Version {
  id: string
  versionTag: string
  appliedAt?: string
  parentVersionId?: string
  approvalStatus?: string
  description?: string
  testStatus?: string
}

interface ApprovePayload {
  approvalId: string
  versionId: string
  changedFiles: string[]
  approved: boolean
}

interface RollbackPayload {
  versionId: string
}

interface ApproveResponse {
  success: boolean
  error?: { message?: string }
}

interface RollbackResponse {
  success: boolean
  data?: { rollbackTag?: string }
  error?: { message?: string }
}

async function fetchPendingApprovals(): Promise<Approval[]> {
  const res = await apiFetch('/api/evolution/approvals')
  const data = (await res.json()) as { data?: Approval[] }
  return data.data || []
}

async function fetchVersions(): Promise<Version[]> {
  const res = await apiFetch('/api/evolution/versions')
  const data = (await res.json()) as { data?: Version[] }
  return data.data || []
}

async function approveEvolution(payload: ApprovePayload): Promise<ApproveResponse> {
  const res = await apiFetch('/api/evolution/approve', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return (await res.json()) as ApproveResponse
}

async function rollbackEvolution(payload: RollbackPayload): Promise<RollbackResponse> {
  const res = await apiFetch('/api/evolution/rollback', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return (await res.json()) as RollbackResponse
}

interface StatusBadgeProps {
  status: string
}

function StatusBadge({ status }: StatusBadgeProps) {
  const styles: Record<string, string> = {
    approved: 'bg-ok/10 text-ok border-ok/20',
    pending: 'bg-warn/10 text-warn border-warn/20',
    denied: 'bg-danger/10 text-danger border-danger/20',
    applied: 'bg-accent/10 text-accent border-accent/20',
  }
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${styles[status] || styles.pending}`}>
      {status === 'approved' && <CheckCircle className="w-3 h-3" />}
      {status === 'pending' && <Clock className="w-3 h-3" />}
      {status === 'denied' && <XCircle className="w-3 h-3" />}
      {status === 'applied' && <GitBranch className="w-3 h-3" />}
      {status}
    </span>
  )
}

export function EvolutionControlPanel() {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const { data: approvals = [], isLoading: approvalsLoading } = useQuery({
    queryKey: ['evolutionApprovals'],
    queryFn: fetchPendingApprovals,
    refetchInterval: 10000,
  })

  const { data: versions = [], isLoading: versionsLoading } = useQuery({
    queryKey: ['evolutionVersions'],
    queryFn: fetchVersions,
    refetchInterval: 30000,
  })

  const approveMutation = useMutation({
    mutationFn: approveEvolution,
    onSuccess: (data) => {
      if (!data.success) {
        setError(data.error?.message || '操作失败')
      } else {
        setError(null)
        queryClient.invalidateQueries({ queryKey: ['evolutionApprovals'] })
        queryClient.invalidateQueries({ queryKey: ['evolutionVersions'] })
        queryClient.invalidateQueries({ queryKey: ['monitoringStatus'] })
      }
    },
    onError: (e: unknown) => setError(String(e)),
  })

  const rollbackMutation = useMutation({
    mutationFn: rollbackEvolution,
    onSuccess: (data) => {
      if (!data.success) {
        setError(data.error?.message || '回滚失败')
      } else {
        setError(null)
        alert(`可回滚至版本 ${data.data?.rollbackTag}`)
      }
    },
    onError: (e: unknown) => setError(String(e)),
  })

  const pendingApprovals = approvals.filter((a) => a.status === 'pending')
  const recentVersions = versions.slice(0, 10)

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
        <Shield className="w-4 h-4 text-accent" />
        进化控制面板
      </h3>

      {error && (
        <div className="mb-3 text-xs text-danger bg-danger/10 border border-danger/20 rounded-lg p-2 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5" />
          {error}
        </div>
      )}

      {/* Pending Approvals */}
      <div className="mb-4">
        <div className="text-xs text-muted mb-2 flex items-center justify-between">
          <span>待审批 ({pendingApprovals.length})</span>
          {approvalsLoading && <span className="text-accent animate-pulse">加载中...</span>}
        </div>
        {pendingApprovals.length === 0 ? (
          <div className="text-xs text-muted bg-secondary/20 rounded-lg p-3">暂无待审批的进化提案</div>
        ) : (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {pendingApprovals.map((a) => (
              <div key={a.id} className="border border-border/50 rounded-lg p-3 text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-white">{a.description || a.id}</span>
                  <StatusBadge status={a.status} />
                </div>
                <div className="text-muted mb-1">Risk: {a.riskScore} · Decision: {a.decision}</div>
                <div className="text-muted/80 mb-2">Files: {a.filesChanged?.length ?? 0}</div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      approveMutation.mutate({
                        approvalId: a.id,
                        versionId: a.versionId || a.id,
                        changedFiles: a.filesChanged || [],
                        approved: true,
                      })
                    }
                    disabled={approveMutation.isPending}
                    className="px-2.5 py-1 bg-ok/20 hover:bg-ok/30 text-ok disabled:opacity-50 rounded text-[10px] flex items-center gap-1 transition"
                  >
                    <CheckCircle className="w-3 h-3" />
                    通过
                  </button>
                  <button
                    onClick={() =>
                      approveMutation.mutate({
                        approvalId: a.id,
                        versionId: a.versionId || a.id,
                        changedFiles: a.filesChanged || [],
                        approved: false,
                      })
                    }
                    disabled={approveMutation.isPending}
                    className="px-2.5 py-1 bg-danger/20 hover:bg-danger/30 text-danger disabled:opacity-50 rounded text-[10px] flex items-center gap-1 transition"
                  >
                    <XCircle className="w-3 h-3" />
                    拒绝
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Version History */}
      <div>
        <div className="text-xs text-muted mb-2 flex items-center justify-between">
          <span>版本历史 ({recentVersions.length})</span>
          {versionsLoading && <span className="text-accent animate-pulse">加载中...</span>}
        </div>
        {recentVersions.length === 0 ? (
          <div className="text-xs text-muted bg-secondary/20 rounded-lg p-3">暂无版本记录</div>
        ) : (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {recentVersions.map((v) => (
              <div key={v.id} className="flex items-center justify-between border border-border/50 rounded-lg p-3 text-xs">
                <div>
                  <div className="flex items-center gap-2">
                    <GitBranch className="w-3.5 h-3.5 text-accent" />
                    <span className="font-medium text-white">{v.versionTag}</span>
                    <StatusBadge status={v.appliedAt ? 'applied' : v.approvalStatus || 'pending'} />
                  </div>
                  <div className="text-muted mt-0.5">{v.description}</div>
                  <div className="text-muted/70 mt-0.5">Test: {v.testStatus || 'unknown'}</div>
                </div>
                {!v.appliedAt && v.parentVersionId && (
                  <button
                    onClick={() => rollbackMutation.mutate({ versionId: v.id })}
                    disabled={rollbackMutation.isPending}
                    className="ml-2 px-2 py-1 bg-secondary hover:bg-secondary/70 disabled:opacity-50 rounded text-[10px] flex items-center gap-1 transition whitespace-nowrap"
                  >
                    <RotateCcw className="w-3 h-3" />
                    回滚
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
