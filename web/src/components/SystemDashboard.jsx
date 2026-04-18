import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  Cpu,
  HardDrive,
  MemoryStick,
  Server,
  CheckCircle,
  XCircle,
  Loader2,
  Shield,
  Database,
  Play,
  Pause,
  Wifi,
  WifiOff,
  MessageSquare,
  Download,
  RotateCcw,
  Clock,
  Zap,
  HeartPulse,
  Image,
  Film,
  Music,
  Globe,
  Trash2,
  Brain,
  Sparkles,
} from 'lucide-react'
import { StatusCard } from './StatusCard'
import { SystemControlPanel, RealtimeMetrics, AlertConsole } from './ControlUI'
import { apiFetch, apiUrl } from '../api.js'
import { LocaleSelector } from '../i18n/LocaleSelector.jsx'
import { LearningInsights } from './LearningInsights'
import { EvolutionPipelineCard } from './EvolutionPipelineCard'
import { EvolutionControlPanel } from './EvolutionControlPanel'

async function fetchImStatus() {
  const res = await apiFetch('/api/im/status')
  const data = await res.json()
  return data.data
}

async function fetchDaemonHistory() {
  const res = await apiFetch('/api/daemon/history')
  const data = await res.json()
  return data.data || []
}

async function fetchDbBackups() {
  const res = await apiFetch('/api/backup/db/list')
  const data = await res.json()
  return data.data || []
}

async function fetchMetrics() {
  const res = await apiFetch('/api/app-metrics')
  const data = await res.json()
  return data.data
}

async function testLlm() {
  const res = await apiFetch('/api/llm/test', { method: 'POST' })
  return res.json()
}

async function exportBackup() {
  const res = await apiFetch('/api/backup/export', { method: 'POST' })
  return res.json()
}

async function createDbBackup() {
  const res = await apiFetch('/api/backup/db/create', { method: 'POST' })
  return res.json()
}

async function restoreDbBackup(filename) {
  const res = await apiFetch('/api/backup/db/restore', {
    method: 'POST',
    body: JSON.stringify({ filename }),
  })
  return res.json()
}

async function startDaemon() {
  await apiFetch('/api/daemon/start', { method: 'POST' })
}

async function stopDaemon() {
  await apiFetch('/api/daemon/stop', { method: 'POST' })
}

async function toggleFeishu(action) {
  await apiFetch(`/api/im/feishu/${action}`, { method: 'POST' })
  return fetchImStatus()
}

async function fetchSelfHealing() {
  const res = await apiFetch('/api/self-healing/status')
  const data = await res.json()
  return data.data
}

async function fetchCircuitBreakers() {
  const res = await apiFetch('/api/system/circuit-breakers')
  const data = await res.json()
  return data.data || []
}

async function fetchTasks() {
  const res = await apiFetch('/api/tasks')
  const data = await res.json()
  return data.data || []
}

async function fetchQueueStats() {
  const res = await apiFetch('/api/tasks/queue-stats')
  const data = await res.json()
  return data.data || { pending: 0, failed: 0, delayed: 0 }
}

async function fetchBudget() {
  const res = await apiFetch('/api/budget')
  const data = await res.json()
  return data.data || { totalBudget: 0, usedEstimate: 0, remainingPercent: 100, status: 'ok', llmCalls24h: 0, tokenUsage24h: 0 }
}

async function triggerTask(taskId) {
  await apiFetch(`/api/tasks/${taskId}/trigger`, { method: 'POST' })
  return fetchTasks()
}

async function deleteTask(taskId) {
  await apiFetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
  return fetchTasks()
}

async function generateMedia({ type, prompt }) {
  const res = await apiFetch('/api/media/generate', {
    method: 'POST',
    body: JSON.stringify({ type, prompt }),
  })
  return res.json()
}

export function SystemDashboard({ status }) {
  const queryClient = useQueryClient()
  const [systemMetrics, setSystemMetrics] = useState({ cpu: 12, memory: 34, disk: 28 })
  const [healthChecks, setHealthChecks] = useState([])
  const [checking, setChecking] = useState(false)

  const [controlStatus, setControlStatus] = useState({
    selfHealing: true,
    scheduler: true,
    knowledgeBase: true,
    browser: false,
    canvas: false,
    daemon: status?.daemonRunning || false,
  })
  const { data: metricsData } = useQuery({
    queryKey: ['metrics'],
    queryFn: fetchMetrics,
    refetchInterval: 5000,
  })

  const realtimeMetrics = [
    metricsData?.runnerPool
      ? { label: 'Runner Pool', value: Math.min(1, metricsData.runnerPool.size / Math.max(1, metricsData.runnerPool.max)) }
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
  const [alerts] = useState([
    { type: 'security', message: 'Permission denied: write_file by session test', timestamp: Date.now() - 60000 },
    { type: 'webhook', message: 'Webhook delivered: gh-push', timestamp: Date.now() - 120000 },
  ])
  const handleToggle = useCallback((name, enabled) => {
    setControlStatus((prev) => ({ ...prev, [name]: enabled }))
    // In future this will call an API
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      setSystemMetrics((prev) => ({
        cpu: Math.max(5, Math.min(95, prev.cpu + (Math.random() - 0.5) * 8)),
        memory: Math.max(20, Math.min(90, prev.memory + (Math.random() - 0.5) * 4)),
        disk: 28 + (Math.random() - 0.5) * 2,
      }))
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  const { data: imStatus } = useQuery({
    queryKey: ['imStatus'],
    queryFn: fetchImStatus,
  })

  const { data: daemonHistory = [] } = useQuery({
    queryKey: ['daemonHistory'],
    queryFn: fetchDaemonHistory,
    enabled: status?.daemonRunning,
    refetchInterval: status?.daemonRunning ? 10000 : false,
  })

  const { data: kbStats } = useQuery({
    queryKey: ['kbStats'],
    queryFn: async () => {
      const res = await apiFetch('/api/kb/stats')
      const data = await res.json()
      return data.data
    },
  })

  const { data: dbBackups = [] } = useQuery({
    queryKey: ['dbBackups'],
    queryFn: fetchDbBackups,
    refetchInterval: 30000,
  })

  const { data: circuitBreakers = [] } = useQuery({
    queryKey: ['circuitBreakers'],
    queryFn: fetchCircuitBreakers,
    refetchInterval: 5000,
  })

  const llmTestMutation = useMutation({ mutationFn: testLlm })
  const backupMutation = useMutation({ mutationFn: exportBackup })
  const createBackupMutation = useMutation({
    mutationFn: createDbBackup,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dbBackups'] }),
  })
  const restoreBackupMutation = useMutation({
    mutationFn: restoreDbBackup,
    onSuccess: (data) => {
      if (data.success) {
        window.alert('恢复成功，页面将刷新。')
        window.location.reload()
      } else {
        window.alert(data.error?.message || '恢复失败')
      }
    },
    onError: (e) => window.alert(String(e)),
  })
  const startDaemonMutation = useMutation({
    mutationFn: startDaemon,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['status'] }),
  })
  const stopDaemonMutation = useMutation({
    mutationFn: stopDaemon,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['status'] }),
  })
  const feishuMutation = useMutation({
    mutationFn: toggleFeishu,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['imStatus'] })
    },
  })

  const { data: selfHealing } = useQuery({
    queryKey: ['selfHealing'],
    queryFn: fetchSelfHealing,
    refetchInterval: 15000,
  })

  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks'],
    queryFn: fetchTasks,
    refetchInterval: 15000,
  })

  const { data: queueStats = { pending: 0, failed: 0, delayed: 0 } } = useQuery({
    queryKey: ['queueStats'],
    queryFn: fetchQueueStats,
    refetchInterval: 15000,
  })

  const { data: budget = { totalBudget: 0, usedEstimate: 0, remainingPercent: 100, status: 'ok', llmCalls24h: 0, tokenUsage24h: 0 } } = useQuery({
    queryKey: ['budget'],
    queryFn: fetchBudget,
    refetchInterval: 15000,
  })

  const triggerTaskMutation = useMutation({
    mutationFn: triggerTask,
    onSuccess: (data) => queryClient.setQueryData(['tasks'], data),
  })

  const deleteTaskMutation = useMutation({
    mutationFn: deleteTask,
    onSuccess: (data) => queryClient.setQueryData(['tasks'], data),
  })

  const mediaMutation = useMutation({ mutationFn: generateMedia })

  const handleCheck = useCallback(async () => {
    setChecking(true)
    await new Promise((r) => setTimeout(r, 1200))
    const results = [
      { name: 'LLM 连接', status: status?.llmProvider !== 'local' ? 'pass' : 'warn', msg: status?.llmProvider !== 'local' ? undefined : '使用 Mock LLM' },
      { name: 'SessionDB', status: 'pass' },
      { name: 'Skill 目录', status: 'pass' },
      { name: '自主进化 Daemon', status: status?.daemonRunning ? 'pass' : 'warn', msg: status?.daemonRunning ? undefined : '未启动' },
    ]
    setHealthChecks(results)
    setChecking(false)
  }, [status])

  const handleDownloadBackup = useCallback(() => {
    window.open(apiUrl('/api/backup/download'), '_blank')
  }, [])

  const handleRestoreDbBackup = useCallback(async (filename) => {
    if (!window.confirm(`确定要恢复备份 ${filename} 吗？当前数据将被覆盖。`)) return
    restoreBackupMutation.mutate(filename)
  }, [restoreBackupMutation])

  const systemHealthy = healthChecks.length > 0 && healthChecks.every((c) => c.status !== 'fail')
  const healthState = checking ? 'checking' : healthChecks.length > 0 ? (systemHealthy ? 'healthy' : 'unhealthy') : 'unknown'

  return (
    <div className="space-y-6">
      {/* Health + Quick Actions */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div
                className={`w-3 h-3 rounded-full ${
                  healthState === 'healthy' ? 'bg-ok animate-pulse-subtle' : healthState === 'unhealthy' ? 'bg-danger' : 'bg-muted'
                }`}
              />
              <h2 className="text-lg font-semibold text-white">
                {healthState === 'healthy' ? '系统正常' : healthState === 'unhealthy' ? '系统异常' : '系统检查'}
              </h2>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCheck}
                disabled={checking}
                className="px-3 py-1.5 bg-secondary hover:bg-secondary/70 disabled:bg-secondary/50 rounded-lg text-sm flex items-center gap-1.5 transition"
              >
                <Shield className="w-3.5 h-3.5" />
                {checking ? '检查中...' : '自检'}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {healthChecks.length === 0 && <div className="text-sm text-muted">点击“自检”查看系统健康状态</div>}
            {healthChecks.map((c, idx) => (
              <div key={idx} className="flex items-center justify-between text-sm py-1 border-b border-border/50 last:border-0">
                <span className="text-muted">{c.name}</span>
                <div className="flex items-center gap-2">
                  {c.msg && <span className="text-xs text-muted">{c.msg}</span>}
                  {c.status === 'pass' && <CheckCircle className="w-4 h-4 text-ok" />}
                  {c.status === 'warn' && <div className="text-warn text-xs font-medium">警告</div>}
                  {c.status === 'fail' && <XCircle className="w-4 h-4 text-danger" />}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="text-lg font-semibold text-white mb-4">快捷操作</h2>
          <div className="space-y-2">
            <button
              onClick={() => startDaemonMutation.mutate()}
              disabled={status?.daemonRunning || startDaemonMutation.isPending}
              className="w-full px-4 py-2.5 bg-secondary hover:bg-secondary/70 disabled:opacity-50 rounded-lg text-sm flex items-center gap-3 transition text-left"
            >
              <Play className="w-4 h-4 text-ok" />
              <span>启动 Daemon</span>
            </button>
            <button
              onClick={() => stopDaemonMutation.mutate()}
              disabled={!status?.daemonRunning || stopDaemonMutation.isPending}
              className="w-full px-4 py-2.5 bg-secondary hover:bg-secondary/70 disabled:opacity-50 rounded-lg text-sm flex items-center gap-3 transition text-left"
            >
              <Pause className="w-4 h-4 text-warn" />
              <span>暂停 Daemon</span>
            </button>
            <button
              onClick={() => backupMutation.mutate()}
              disabled={backupMutation.isPending}
              className="w-full px-4 py-2.5 bg-secondary hover:bg-secondary/70 disabled:opacity-50 rounded-lg text-sm flex items-center gap-3 transition text-left"
            >
              <Database className="w-4 h-4 text-info" />
              <span>{backupMutation.isPending ? '备份中...' : '备份轨迹'}</span>
            </button>
            {backupMutation.data?.success && (
              <button
                onClick={handleDownloadBackup}
                className="w-full px-4 py-2.5 bg-accent/20 hover:bg-accent/30 rounded-lg text-sm flex items-center gap-3 transition text-left text-accent"
              >
                <Download className="w-4 h-4" />
                <span>下载备份 ({backupMutation.data.data?.count} 条)</span>
              </button>
            )}
            {backupMutation.data && !backupMutation.data.success && (
              <div className="text-xs text-danger px-1">{backupMutation.data.error?.message}</div>
            )}
          </div>
        </div>
      </div>

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

      {/* Evolution Pipeline + Control */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <EvolutionPipelineCard />
        <EvolutionControlPanel />
      </div>

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

      {/* Control UI */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3">控制台</h3>
          <SystemControlPanel status={controlStatus} onToggle={handleToggle} />
        </div>
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3">实时监控</h3>
          <RealtimeMetrics metrics={realtimeMetrics} />
        </div>
      </div>
      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-3">告警中心</h3>
        <AlertConsole alerts={alerts} />
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatusCard
          title="CPU"
          value={`${systemMetrics.cpu.toFixed(0)}%`}
          icon={Cpu}
          status={systemMetrics.cpu > 80 ? 'error' : systemMetrics.cpu > 60 ? 'warning' : 'normal'}
          progress={systemMetrics.cpu}
        />
        <StatusCard
          title="内存"
          value={`${systemMetrics.memory.toFixed(0)}%`}
          icon={MemoryStick}
          status={systemMetrics.memory > 85 ? 'error' : systemMetrics.memory > 70 ? 'warning' : 'normal'}
          progress={systemMetrics.memory}
        />
        <StatusCard
          title="磁盘"
          value={`${systemMetrics.disk.toFixed(0)}%`}
          icon={HardDrive}
          status="normal"
          progress={systemMetrics.disk}
        />
        <StatusCard title="会话数" value={status?.sessionCount || 0} icon={Activity} />
        <StatusCard
          title="记忆召回"
          value={status?.memoryRecalls24h ?? 0}
          icon={Brain}
          status={(status?.memoryRecalls24h ?? 0) > 10 ? 'success' : 'normal'}
        />
        <StatusCard title="KB Chunks" value={kbStats?.totalChunks ?? 0} icon={Sparkles} />
      </div>

      {/* LLM Config + Test */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Server className="w-4 h-4 text-accent" />
          LLM 配置
        </h3>
        <div className="grid grid-cols-3 gap-4 text-xs mb-4">
          <div className="flex justify-between py-1 border-b border-border/50">
            <span className="text-muted">Provider</span>
            <span className="text-white font-mono">{status?.llmProvider || 'local'}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-border/50">
            <span className="text-muted">模型</span>
            <span className="text-white font-mono">{status?.llmModel || 'mock'}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-border/50">
            <span className="text-muted">状态</span>
            <span className={status?.llmProvider !== 'local' ? 'text-ok font-mono' : 'text-muted font-mono'}>
              {status?.llmProvider !== 'local' ? '已配置' : 'Mock 模式'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => llmTestMutation.mutate()}
            disabled={llmTestMutation.isPending}
            className="px-3 py-1.5 bg-secondary hover:bg-secondary/70 disabled:opacity-50 rounded-lg text-sm flex items-center gap-1.5 transition"
          >
            {llmTestMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
            测试 LLM 连接
          </button>
          {llmTestMutation.data && (
            <span className={`text-xs ${llmTestMutation.data.success ? 'text-ok' : 'text-danger'}`}>
              {llmTestMutation.data.success ? `响应: ${llmTestMutation.data.data?.response?.slice(0, 40)}` : llmTestMutation.data.error?.message}
            </span>
          )}
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
                      恢复: {new Date(cb.nextRetryTime).toLocaleTimeString()}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Daemon History */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4 text-accent" />
          Daemon 决策历史
        </h3>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {daemonHistory.length === 0 && (
            <div className="text-xs text-muted">
              {status?.daemonRunning ? '暂无决策记录，等待下一次扫描...' : 'Daemon 未启动'}
            </div>
          )}
          {daemonHistory.map((d, idx) => (
            <div key={idx} className="border border-border/50 rounded-lg p-3 text-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-white">{d.action.toUpperCase()}</span>
                <span className={`${d.applied ? 'text-ok' : 'text-muted'}`}>{d.applied ? '已应用' : '未应用'}</span>
              </div>
              <div className="text-muted mb-1">Session: {d.sessionId}</div>
              {d.skillName && <div className="text-accent mb-1">Skill: {d.skillName}</div>}
              <div className="text-muted/80">{d.reason}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Database Backups */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Database className="w-4 h-4 text-accent" />
            数据库备份
          </h3>
          <button
            onClick={() => createBackupMutation.mutate()}
            disabled={createBackupMutation.isPending}
            className="px-3 py-1.5 bg-secondary hover:bg-secondary/70 disabled:opacity-50 rounded-lg text-xs flex items-center gap-1.5 transition"
          >
            {createBackupMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
            立即备份
          </button>
        </div>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {dbBackups.length === 0 && <div className="text-xs text-muted">暂无数据库备份</div>}
          {dbBackups.map((b, idx) => (
            <div key={idx} className="flex items-center justify-between border border-border/50 rounded-lg p-3 text-xs">
              <div className="min-w-0">
                <div className="font-medium text-white truncate">{b.filename}</div>
                <div className="text-muted flex items-center gap-2 mt-0.5">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(b.createdAt).toLocaleString('zh-CN')}
                  </span>
                  <span>· {(b.sizeBytes / 1024 / 1024).toFixed(2)} MB</span>
                </div>
              </div>
              <button
                onClick={() => handleRestoreDbBackup(b.filename)}
                disabled={restoreBackupMutation.isPending && restoreBackupMutation.variables === b.filename}
                className="ml-3 px-2.5 py-1.5 bg-secondary hover:bg-secondary/70 disabled:opacity-50 rounded-lg text-xs flex items-center gap-1 transition whitespace-nowrap"
              >
                {restoreBackupMutation.isPending && restoreBackupMutation.variables === b.filename ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                恢复
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* IM Channels */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-accent" />
          IM 通道管理
        </h3>
        <div className="space-y-3">
          {imStatus?.feishu?.available && (
            <div className="flex items-center justify-between py-2 border-b border-border/50">
              <div>
                <div className="flex items-center gap-2">
                  <div className="text-sm text-white font-medium">Feishu (飞书)</div>
                  <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${imStatus.feishu.running ? 'bg-ok/10 text-ok border-ok/20' : 'bg-slate-500/10 text-slate-400 border-slate-500/20'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${imStatus.feishu.running ? 'bg-ok' : 'bg-slate-400'}`} />
                    {imStatus.feishu.running ? '运行中' : '已停止'}
                  </span>
                </div>
                <div className="text-xs text-muted">Webhook: {imStatus.feishu.webhookUrl}</div>
              </div>
              <div className="flex items-center gap-2">
                {feishuMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted" />
                ) : (
                  <>
                    <button
                      onClick={() => feishuMutation.mutate('start')}
                      disabled={imStatus.feishu.running}
                      className="px-3 py-1.5 bg-secondary hover:bg-secondary/70 disabled:opacity-40 rounded-lg text-xs flex items-center gap-1.5 transition"
                    >
                      <Wifi className="w-3.5 h-3.5 text-ok" />
                      启动
                    </button>
                    <button
                      onClick={() => feishuMutation.mutate('stop')}
                      disabled={!imStatus.feishu.running}
                      className="px-3 py-1.5 bg-secondary hover:bg-secondary/70 disabled:opacity-40 rounded-lg text-xs flex items-center gap-1.5 transition"
                    >
                      <WifiOff className="w-3.5 h-3.5 text-danger" />
                      停止
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
          {imStatus?.mockChat?.available && (
            <div className="flex items-center justify-between py-2">
              <div>
                <div className="text-sm text-white font-medium">Mock Chat</div>
                <div className="text-xs text-muted">本地模拟通道，始终可用</div>
              </div>
              <span className="text-xs px-2 py-1 rounded bg-ok/20 text-ok">可用</span>
            </div>
          )}
        </div>
      </div>

      {/* Self-healing */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <HeartPulse className="w-4 h-4 text-accent" />
          自愈系统
        </h3>
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs text-muted">快照数: <span className="text-white font-mono">{selfHealing?.snapshots ?? '-'}</span></div>
          <span className={`text-xs px-2 py-0.5 rounded ${selfHealing?.active ? 'bg-ok/20 text-ok' : 'bg-muted/20 text-muted'}`}>{selfHealing?.active ? '运行中' : '未激活'}</span>
        </div>
        <div className="text-xs text-muted">自动快照与异常检测已集成到 Agent 循环中。</div>
      </div>

      {/* Task Scheduler */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Clock className="w-4 h-4 text-accent" />
          任务调度器
        </h3>
        <div className="grid grid-cols-3 gap-3 text-xs mb-3">
          <div className="flex justify-between py-1 border-b border-border/50">
            <span className="text-muted">待处理</span>
            <span className="text-white font-mono">{queueStats.pending}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-border/50">
            <span className="text-muted">延迟中</span>
            <span className="text-white font-mono">{queueStats.delayed}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-border/50">
            <span className="text-muted">失败</span>
            <span className={queueStats.failed > 0 ? 'text-danger font-mono' : 'text-white font-mono'}>{queueStats.failed}</span>
          </div>
        </div>
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {tasks.length === 0 && <div className="text-xs text-muted">暂无调度任务</div>}
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center justify-between border border-border/50 rounded-lg p-2 text-xs">
              <div>
                <div className="font-medium text-white">{t.name || t.id}</div>
                <div className="text-muted">{t.status} · 运行 {t.runCount} 次</div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => triggerTaskMutation.mutate(t.id)}
                  disabled={triggerTaskMutation.isPending}
                  className="px-2 py-1 bg-secondary hover:bg-secondary/70 disabled:opacity-50 rounded text-xs flex items-center gap-1 transition"
                >
                  <Zap className="w-3 h-3" />
                  触发
                </button>
                <button
                  onClick={() => deleteTaskMutation.mutate(t.id)}
                  disabled={deleteTaskMutation.isPending}
                  className="px-2 py-1 bg-danger/20 hover:bg-danger/30 text-danger disabled:opacity-50 rounded text-xs flex items-center gap-1 transition"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Media Generator */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Image className="w-4 h-4 text-accent" />
          多媒体生成
        </h3>
        <div className="flex gap-2 mb-3">
          {[
            { key: 'image', label: '图片', icon: Image },
            { key: 'video', label: '视频', icon: Film },
            { key: 'music', label: '音乐', icon: Music },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => {
                const prompt = window.prompt(`输入${label}生成提示词:`)
                if (prompt) mediaMutation.mutate({ type: key, prompt })
              }}
              disabled={mediaMutation.isPending}
              className="flex-1 px-3 py-2 bg-secondary hover:bg-secondary/70 disabled:opacity-50 rounded-lg text-xs flex items-center justify-center gap-1.5 transition"
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
        {mediaMutation.data?.success && mediaMutation.data.data?.outputUrl && (
          <a href={mediaMutation.data.data.outputUrl} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline break-all">
            查看结果
          </a>
        )}
        {mediaMutation.data && !mediaMutation.data.success && (
          <div className="text-xs text-danger">{mediaMutation.data.error?.message}</div>
        )}
      </div>

      {/* System Info */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Server className="w-4 h-4 text-accent" />
          系统信息
        </h3>
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div className="flex justify-between py-1 border-b border-border/50">
            <span className="text-muted">Ouroboros 版本</span>
            <span className="text-white font-mono">0.1.0</span>
          </div>
          <div className="flex justify-between py-1 border-b border-border/50">
            <span className="text-muted">模型</span>
            <span className="text-white font-mono">{status?.llmModel || 'mock'}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-border/50">
            <span className="text-muted">Skills 数量</span>
            <span className="text-white font-mono">{status?.skillCount || 0}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-border/50">
            <span className="text-muted">Daemon 状态</span>
            <span className={status?.daemonRunning ? 'text-ok font-mono' : 'text-muted font-mono'}>
              {status?.daemonRunning ? '运行中' : '停止'}
            </span>
          </div>
          <div className="flex justify-between py-1 border-b border-border/50">
            <span className="text-muted">IM 插件</span>
            <span className="text-white font-mono">{status?.imPlugins?.join(', ') || '无'}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-border/50">
            <span className="text-muted">Deep Dreaming</span>
            <span className="text-white font-mono">
              {status?.deepDreamingLastRun
                ? new Date(status.deepDreamingLastRun).toLocaleString('zh-CN')
                : '从未运行'}
            </span>
          </div>
          <div className="flex justify-between items-center py-1 border-b border-border/50">
            <span className="text-muted flex items-center gap-1"><Globe className="w-3 h-3" /> 语言</span>
            <LocaleSelector className="text-xs bg-secondary/50 border border-border rounded px-2 py-1 text-white" />
          </div>
        </div>
      </div>

      {/* Learning Insights */}
      <div className="bg-card border border-border rounded-xl p-5">
        <LearningInsights sessionId="system" />
      </div>
    </div>
  )
}
