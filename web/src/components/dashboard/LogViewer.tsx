import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  Database,
  Loader2,
  RotateCcw,
  Clock,
} from 'lucide-react'
import { apiFetch } from '../../api'
import type { SystemStatus, DaemonHistoryItem, DbBackup } from './types'

async function fetchDaemonHistory(): Promise<DaemonHistoryItem[]> {
  const res = await apiFetch('/api/daemon/history')
  const data = (await res.json()) as { data?: DaemonHistoryItem[] }
  return data.data || []
}

async function fetchDbBackups(): Promise<DbBackup[]> {
  const res = await apiFetch('/api/backup/db/list')
  const data = (await res.json()) as { data?: DbBackup[] }
  return data.data || []
}

async function createDbBackup(): Promise<Record<string, unknown>> {
  const res = await apiFetch('/api/backup/db/create', { method: 'POST' })
  return res.json() as Promise<Record<string, unknown>>
}

async function restoreDbBackup(filename: string): Promise<Record<string, unknown>> {
  const res = await apiFetch('/api/backup/db/restore', {
    method: 'POST',
    body: JSON.stringify({ filename }),
  })
  return res.json() as Promise<Record<string, unknown>>
}

export function LogViewer({ status }: { status?: SystemStatus }) {
  const queryClient = useQueryClient()

  const { data: daemonHistory = [] } = useQuery({
    queryKey: ['daemonHistory'],
    queryFn: fetchDaemonHistory,
    enabled: status?.daemonRunning,
    refetchInterval: status?.daemonRunning ? 10000 : false,
  })

  const { data: dbBackups = [] } = useQuery({
    queryKey: ['dbBackups'],
    queryFn: fetchDbBackups,
    refetchInterval: 30000,
  })

  const createBackupMutation = useMutation({
    mutationFn: createDbBackup,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dbBackups'] }),
  })

  const restoreBackupMutation = useMutation({
    mutationFn: restoreDbBackup,
    onSuccess: (data: Record<string, unknown>) => {
      if (data.success) {
        window.alert('恢复成功，页面将刷新。')
        window.location.reload()
      } else {
        window.alert((data.error as Record<string, string>)?.message || '恢复失败')
      }
    },
    onError: (e: unknown) => window.alert(String(e)),
  })

  const handleRestoreDbBackup = async (filename: string) => {
    if (!window.confirm(`确定要恢复备份 ${filename} 吗？当前数据将被覆盖。`)) return
    restoreBackupMutation.mutate(filename)
  }

  return (
    <div className="space-y-6">
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
    </div>
  )
}
