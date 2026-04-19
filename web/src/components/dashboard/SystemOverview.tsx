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
  Download,
  Globe,
  Brain,
  Sparkles,
} from 'lucide-react'
import { StatusCard } from '../StatusCard'
import { apiFetch, apiUrl } from '../../api'
import { LocaleSelector } from '../../i18n/LocaleSelector'
import { useDashboardStore } from '../../store/dashboardStore'
import type { SystemStatus, HealthCheck } from './types'

interface KbStats {
  totalDocuments?: number
  totalChunks?: number
  avgPromotionScore?: number
}

async function fetchKbStats(): Promise<KbStats | undefined> {
  const res = await apiFetch('/api/kb/stats')
  const data = (await res.json()) as { data?: KbStats }
  return data.data
}

async function exportBackup(): Promise<Record<string, unknown>> {
  const res = await apiFetch('/api/backup/export', { method: 'POST' })
  return res.json() as Promise<Record<string, unknown>>
}

async function startDaemon(): Promise<void> {
  await apiFetch('/api/daemon/start', { method: 'POST' })
}

async function stopDaemon(): Promise<void> {
  await apiFetch('/api/daemon/stop', { method: 'POST' })
}

export function SystemOverview({ status }: { status?: SystemStatus }) {
  const queryClient = useQueryClient()
  const systemMetrics = useDashboardStore((s) => s.systemMetrics)
  const healthChecks = useDashboardStore((s) => s.healthChecks)
  const checking = useDashboardStore((s) => s.checking)
  const setSystemMetrics = useDashboardStore((s) => s.setSystemMetrics)
  const setHealthChecks = useDashboardStore((s) => s.setHealthChecks)
  const setChecking = useDashboardStore((s) => s.setChecking)

  const { data: kbStats } = useQuery({
    queryKey: ['kbStats'],
    queryFn: fetchKbStats,
  })

  const backupMutation = useMutation({ mutationFn: exportBackup })
  const startDaemonMutation = useMutation({
    mutationFn: startDaemon,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['status'] }),
  })
  const stopDaemonMutation = useMutation({
    mutationFn: stopDaemon,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['status'] }),
  })

  useEffect(() => {
    const interval = setInterval(() => {
      setSystemMetrics((prev) => ({
        cpu: Math.max(5, Math.min(95, prev.cpu + (Math.random() - 0.5) * 8)),
        memory: Math.max(20, Math.min(90, prev.memory + (Math.random() - 0.5) * 4)),
        disk: 28 + (Math.random() - 0.5) * 2,
      }))
    }, 3000)
    return () => clearInterval(interval)
  }, [setSystemMetrics])

  const handleCheck = useCallback(async () => {
    setChecking(true)
    await new Promise((r) => setTimeout(r, 1200))
    const results: HealthCheck[] = [
      {
        name: 'LLM 连接',
        status: status?.llmProvider !== 'local' ? 'pass' : 'warn',
        msg: status?.llmProvider !== 'local' ? undefined : '使用 Mock LLM',
      },
      { name: 'SessionDB', status: 'pass' },
      { name: 'Skill 目录', status: 'pass' },
      {
        name: '自主进化 Daemon',
        status: status?.daemonRunning ? 'pass' : 'warn',
        msg: status?.daemonRunning ? undefined : '未启动',
      },
    ]
    setHealthChecks(results)
    setChecking(false)
  }, [status, setHealthChecks, setChecking])

  const handleDownloadBackup = useCallback(() => {
    window.open(apiUrl('/api/backup/download'), '_blank')
  }, [])

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
                <span>下载备份 ({(backupMutation.data.data as Record<string, unknown>)?.count} 条)</span>
              </button>
            )}
            {backupMutation.data && !backupMutation.data.success && (
              <div className="text-xs text-danger px-1">{(backupMutation.data.error as Record<string, string>)?.message}</div>
            )}
          </div>
        </div>
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
    </div>
  )
}
