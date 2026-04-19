import { useQuery } from '@tanstack/react-query'
import { Shield } from 'lucide-react'
import { RealtimeMetrics, AlertConsole } from '../ControlUI'
import { apiFetch } from '../../api'
import { useDashboardStore } from '../../store/dashboardStore'
import type { MetricsData, CircuitBreaker, Budget, RealtimeMetric } from './types'

async function fetchMetrics(): Promise<MetricsData | undefined> {
  const res = await apiFetch('/api/app-metrics')
  const data = (await res.json()) as { data?: MetricsData }
  return data.data
}

async function fetchCircuitBreakers(): Promise<CircuitBreaker[]> {
  const res = await apiFetch('/api/system/circuit-breakers')
  const data = (await res.json()) as { data?: CircuitBreaker[] }
  return data.data || []
}

async function fetchBudget(): Promise<Budget> {
  const res = await apiFetch('/api/budget')
  const data = (await res.json()) as { data?: Budget }
  return data.data || { totalBudget: 0, usedEstimate: 0, remainingPercent: 100, status: 'ok', llmCalls24h: 0, tokenUsage24h: 0 }
}

export function MetricsPanel() {
  const alerts = useDashboardStore((s) => s.alerts)

  const { data: metricsData } = useQuery({
    queryKey: ['metrics'],
    queryFn: fetchMetrics,
    refetchInterval: 5000,
  })

  const { data: circuitBreakers = [] } = useQuery({
    queryKey: ['circuitBreakers'],
    queryFn: fetchCircuitBreakers,
    refetchInterval: 5000,
  })

  const { data: budget = { totalBudget: 0, usedEstimate: 0, remainingPercent: 100, status: 'ok', llmCalls24h: 0, tokenUsage24h: 0 } } = useQuery({
    queryKey: ['budget'],
    queryFn: fetchBudget,
    refetchInterval: 15000,
  })

  const realtimeMetrics: RealtimeMetric[] = [
    metricsData?.runnerPool
      ? { label: 'Runner Pool', value: Math.min(1, (metricsData.runnerPool.size ?? 0) / Math.max(1, metricsData.runnerPool.max ?? 1)) }
      : { label: 'Runner Pool', value: 0 },
    metricsData?.memoryUsageMB
      ? { label: 'Memory', value: Math.min(1, metricsData.memoryUsageMB / 512) }
      : { label: 'Memory', value: 0 },
    { type: 'number', label: 'WS 在线', value: metricsData?.wsClients ?? 0 },
    { type: 'number', label: 'WS 总连接', value: metricsData?.wsConnectionsTotal ?? 0 },
    { type: 'number', label: '待处理任务', value: metricsData?.tasksPending ?? 0 },
    { type: 'number', label: '运行中任务', value: metricsData?.tasksRunning ?? 0 },
    { type: 'number', label: '运行时长', value: metricsData?.uptimeSeconds ?? 0, suffix: 's' },
    metricsData?.llmLatencyMs
      ? { type: 'latency', label: 'LLM 平均延迟', value: metricsData.llmLatencyMs }
      : { type: 'latency', label: 'LLM 平均延迟', value: 0 },
    metricsData?.llmP95LatencyMs
      ? { type: 'latency', label: 'LLM P95 延迟', value: metricsData.llmP95LatencyMs }
      : { type: 'latency', label: 'LLM P95 延迟', value: 0 },
    { type: 'number', label: 'LLM 调用数', value: metricsData?.llmCalls ?? 0 },
    typeof metricsData?.tokenUsage24h === 'number' && typeof metricsData?.tokenAlertThreshold === 'number'
      ? { label: 'Token 用量 (24h)', value: Math.min(1, metricsData.tokenUsage24h / Math.max(1, metricsData.tokenAlertThreshold)) }
      : { label: 'Token 用量 (24h)', value: 0 },
  ]

  return (
    <div className="space-y-6">
      {/* Budget Banner */}
      {budget.status === 'critical' && (
        <div className="bg-danger/10 border border-danger/30 rounded-xl p-4 flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-danger animate-pulse" />
          <div className="text-sm text-danger">
            预算严重超支警告：剩余预算已低于 5%，系统已限制非只读操作。
          </div>
        </div>
      )}
      {budget.status === 'warning' && (
        <div className="bg-warn/10 border border-warn/30 rounded-xl p-4 flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-warn" />
          <div className="text-sm text-warn">
            预算警告：剩余预算已低于 20%，请注意控制 LLM 调用量。
          </div>
        </div>
      )}

      {/* Budget Card */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white">预算监控</h3>
          <span className={`text-xs font-medium px-2 py-0.5 rounded ${budget.status === 'critical' ? 'bg-danger/20 text-danger' : budget.status === 'warning' ? 'bg-warn/20 text-warn' : 'bg-ok/20 text-ok'}`}>
            {budget.status === 'critical' ? '严重' : budget.status === 'warning' ? '警告' : '正常'}
          </span>
        </div>
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-xs text-muted mb-1">
              <span>剩余预算</span>
              <span>{budget.remainingPercent.toFixed(1)}% (${(budget.totalBudget - budget.usedEstimate).toFixed(2)} / ${budget.totalBudget.toFixed(2)})</span>
            </div>
            <div className="h-2 bg-secondary/50 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${budget.status === 'critical' ? 'bg-danger' : budget.status === 'warning' ? 'bg-warn' : 'bg-ok'}`}
                style={{ width: `${Math.max(0, Math.min(100, budget.remainingPercent))}%` }}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="bg-secondary/30 rounded-lg p-3">
              <div className="text-xs text-muted">24h Token 用量</div>
              <div className="text-white font-medium">{budget.tokenUsage24h.toLocaleString()}</div>
            </div>
            <div className="bg-secondary/30 rounded-lg p-3">
              <div className="text-xs text-muted">24h LLM 调用</div>
              <div className="text-white font-medium">{budget.llmCalls24h.toLocaleString()}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Realtime Metrics + Alert Console */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3">实时监控</h3>
          <RealtimeMetrics metrics={realtimeMetrics} />
        </div>
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3">告警中心</h3>
          <AlertConsole alerts={alerts} />
        </div>
      </div>

      {/* Circuit Breakers */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Shield className="w-4 h-4 text-accent" />
          LLM 熔断器状态
        </h3>
        {circuitBreakers.length === 0 ? (
          <div className="text-xs text-muted">暂无熔断器记录</div>
        ) : (
          <div className="space-y-2">
            {circuitBreakers.map((cb) => (
              <div key={cb.provider} className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0">
                <span className="text-white font-mono">{cb.provider}</span>
                <div className="flex items-center gap-3">
                  <span className={cb.state === 'OPEN' ? 'text-danger' : 'text-ok'}>
                    {cb.state === 'OPEN' ? '已熔断' : '正常'}
                  </span>
                  <span className="text-muted">失败: {cb.failureCount}</span>
                  {cb.state === 'OPEN' && (
                    <span className="text-muted">
                      恢复: {new Date(cb.nextRetryTime as number | string).toLocaleTimeString()}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
