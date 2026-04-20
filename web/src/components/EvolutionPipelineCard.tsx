import { useQuery } from '@tanstack/react-query'
import { GitBranch, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react'
import { apiFetch } from '../api'

interface MonitoringStatus {
  eventBus?: { running?: boolean; queueSize?: number; pendingDeadLetters?: number }
  safety?: {
    lockHeld?: boolean
    frozen?: boolean
    freezeRemainingHours?: number
    budget?: { withinBudget?: boolean }
  }
  approvals?: { pendingCount?: number }
  evolutionVersions?: { totalVersions?: number; currentTag?: string }
  testRuns?: {
    lastRun?: { status: string; mode: string; passed: number; failed: number }
  }
  evolutionMetrics?: { totalEvolutions?: number; successRate?: number; rollbackRate?: number }
}

async function fetchMonitoringStatus(): Promise<MonitoringStatus | undefined> {
  const res = await apiFetch('/api/monitoring/status')
  const data = (await res.json()) as { data?: MonitoringStatus }
  return data.data
}

interface StatusBadgeProps {
  ok: boolean
  label: string
}

function StatusBadge({ ok, label }: StatusBadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${ok ? 'bg-ok/10 text-ok border-ok/20' : 'bg-danger/10 text-danger border-danger/20'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-ok' : 'bg-danger'}`} />
      {label}
    </span>
  )
}

export function EvolutionPipelineCard() {
  const { data: mon } = useQuery({
    queryKey: ['monitoringStatus'],
    queryFn: fetchMonitoringStatus,
    refetchInterval: 10000,
  })

  if (!mon) {
    return (
      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-accent" />
          进化管道
        </h3>
        <div className="text-xs text-muted">加载中...</div>
      </div>
    )
  }

  const { eventBus, safety, approvals, evolutionVersions, testRuns, evolutionMetrics } = mon || {}

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
        <GitBranch className="w-4 h-4 text-accent" />
        进化管道
      </h3>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="bg-secondary/30 rounded-lg p-3">
          <div className="text-xs text-muted">EventBus 队列</div>
          <div className="text-white font-medium flex items-center gap-2">
            {eventBus?.running ? <CheckCircle className="w-3.5 h-3.5 text-ok" /> : <Clock className="w-3.5 h-3.5 text-muted" />}
            {eventBus?.queueSize ?? 0}
          </div>
        </div>
        <div className="bg-secondary/30 rounded-lg p-3">
          <div className="text-xs text-muted">死信队列</div>
          <div className="text-white font-medium flex items-center gap-2">
            {(eventBus?.pendingDeadLetters ?? 0) > 0 ? <AlertTriangle className="w-3.5 h-3.5 text-warn" /> : <CheckCircle className="w-3.5 h-3.5 text-ok" />}
            {eventBus?.pendingDeadLetters ?? 0}
          </div>
        </div>
        <div className="bg-secondary/30 rounded-lg p-3">
          <div className="text-xs text-muted">版本数</div>
          <div className="text-white font-medium">{evolutionVersions?.totalVersions ?? 0}</div>
        </div>
        <div className="bg-secondary/30 rounded-lg p-3">
          <div className="text-xs text-muted">待审批</div>
          <div className="text-white font-medium flex items-center gap-2">
            {(approvals?.pendingCount ?? 0) > 0 ? <Clock className="w-3.5 h-3.5 text-warn" /> : <CheckCircle className="w-3.5 h-3.5 text-ok" />}
            {approvals?.pendingCount ?? 0}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div className="flex items-center justify-between text-xs py-1 border-b border-border/50">
          <span className="text-muted">Safety Lock</span>
          <StatusBadge ok={!safety?.lockHeld} label={safety?.lockHeld ? '已锁定' : '未锁定'} />
        </div>
        <div className="flex items-center justify-between text-xs py-1 border-b border-border/50">
          <span className="text-muted">Freeze</span>
          <StatusBadge ok={!safety?.frozen} label={safety?.frozen ? `冻结 ${(safety?.freezeRemainingHours ?? 0).toFixed(1)}h` : '未冻结'} />
        </div>
        <div className="flex items-center justify-between text-xs py-1 border-b border-border/50">
          <span className="text-muted">Budget</span>
          <StatusBadge ok={safety?.budget?.withinBudget ?? false} label={safety?.budget?.withinBudget ? '正常' : '超支'} />
        </div>
      </div>

      {testRuns?.lastRun && (
        <div className="flex items-center justify-between text-xs py-1 border-b border-border/50">
          <span className="text-muted">最近测试</span>
          <div className="flex items-center gap-2">
            <span className={testRuns.lastRun.status === 'passed' ? 'text-ok' : testRuns.lastRun.status === 'failed' ? 'text-danger' : 'text-muted'}>
              {testRuns.lastRun.mode === 'full' ? '全量' : '增量'} {testRuns.lastRun.passed}/{testRuns.lastRun.passed + testRuns.lastRun.failed}
            </span>
            {testRuns.lastRun.status === 'passed' && <CheckCircle className="w-3.5 h-3.5 text-ok" />}
            {testRuns.lastRun.status === 'failed' && <XCircle className="w-3.5 h-3.5 text-danger" />}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-xs py-1 border-b border-border/50">
        <span className="text-muted">总进化次数</span>
        <span className="text-white font-mono">{evolutionMetrics?.totalEvolutions ?? 0}</span>
      </div>
      <div className="flex items-center justify-between text-xs py-1 border-b border-border/50">
        <span className="text-muted">成功率</span>
        <span className="text-white font-mono">{(evolutionMetrics?.successRate ?? 0).toFixed(1)}%</span>
      </div>
      <div className="flex items-center justify-between text-xs py-1">
        <span className="text-muted">回滚率</span>
        <span className={(evolutionMetrics?.rollbackRate ?? 0) > 10 ? 'text-danger font-mono' : 'text-white font-mono'}>{(evolutionMetrics?.rollbackRate ?? 0).toFixed(1)}%</span>
      </div>

      {evolutionVersions?.currentTag && (
        <div className="mt-3 pt-3 border-t border-border/50">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">当前版本</span>
            <span className="text-accent font-mono">{evolutionVersions.currentTag}</span>
          </div>
        </div>
      )}
    </div>
  )
}
