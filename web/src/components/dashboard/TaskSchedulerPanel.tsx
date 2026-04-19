import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Clock, Zap, Trash2 } from 'lucide-react'
import { apiFetch } from '../../api'
import type { TaskItem, QueueStats } from './types'

async function fetchTasks(): Promise<TaskItem[]> {
  const res = await apiFetch('/api/tasks')
  const data = (await res.json()) as { data?: TaskItem[] }
  return data.data || []
}

async function fetchQueueStats(): Promise<QueueStats> {
  const res = await apiFetch('/api/tasks/queue-stats')
  const data = (await res.json()) as { data?: QueueStats }
  return data.data || { pending: 0, failed: 0, delayed: 0 }
}

async function triggerTask(taskId: string): Promise<TaskItem[]> {
  await apiFetch(`/api/tasks/${taskId}/trigger`, { method: 'POST' })
  return fetchTasks()
}

async function deleteTask(taskId: string): Promise<TaskItem[]> {
  await apiFetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
  return fetchTasks()
}

export function TaskSchedulerPanel() {
  const queryClient = useQueryClient()

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

  const triggerTaskMutation = useMutation({
    mutationFn: triggerTask,
    onSuccess: (data) => queryClient.setQueryData(['tasks'], data),
  })

  const deleteTaskMutation = useMutation({
    mutationFn: deleteTask,
    onSuccess: (data) => queryClient.setQueryData(['tasks'], data),
  })

  return (
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
  )
}
