import { useCallback } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  Activity,
  Server,
  Loader2,
  MessageSquare,
  Wifi,
  WifiOff,
  HeartPulse,
  Image,
  Film,
  Music,
} from 'lucide-react'
import { SystemControlPanel } from '../ControlUI'
import { apiFetch } from '../../api'
import { useDashboardStore } from '../../store/dashboardStore'
import type { SystemStatus, ImStatus, SelfHealing } from './types'

async function testLlm(): Promise<Record<string, unknown>> {
  const res = await apiFetch('/api/llm/test', { method: 'POST' })
  return res.json() as Promise<Record<string, unknown>>
}

async function fetchImStatus(): Promise<ImStatus | undefined> {
  const res = await apiFetch('/api/im/status')
  const data = (await res.json()) as { data?: ImStatus }
  return data.data
}

async function toggleFeishu(action: string): Promise<ImStatus | undefined> {
  await apiFetch(`/api/im/feishu/${action}`, { method: 'POST' })
  return fetchImStatus()
}

async function fetchSelfHealing(): Promise<SelfHealing | undefined> {
  const res = await apiFetch('/api/self-healing/status')
  const data = (await res.json()) as { data?: SelfHealing }
  return data.data
}

async function generateMedia({ type, prompt }: { type: string; prompt: string }): Promise<Record<string, unknown>> {
  const res = await apiFetch('/api/media/generate', {
    method: 'POST',
    body: JSON.stringify({ type, prompt }),
  })
  return res.json() as Promise<Record<string, unknown>>
}

export function ConfigPanel({ status }: { status?: SystemStatus }) {
  const controlStatus = useDashboardStore((s) => s.controlStatus)
  const setControlStatus = useDashboardStore((s) => s.setControlStatus)

  const llmTest = useMutation({ mutationFn: testLlm })

  const { data: imStatus } = useQuery({
    queryKey: ['imStatus'],
    queryFn: fetchImStatus,
  })

  const feishuMutation = useMutation({
    mutationFn: toggleFeishu,
  })

  const { data: selfHealing } = useQuery({
    queryKey: ['selfHealing'],
    queryFn: fetchSelfHealing,
    refetchInterval: 15000,
  })

  const mediaMutation = useMutation({ mutationFn: generateMedia })

  const handleToggle = useCallback(
    (name: string, enabled: boolean) => {
      setControlStatus((prev) => ({ ...prev, [name]: enabled }))
    },
    [setControlStatus]
  )

  return (
    <div className="space-y-6">
      {/* Control UI */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-3">控制台</h3>
        <SystemControlPanel status={controlStatus} onToggle={handleToggle} />
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
            onClick={() => llmTest.mutate()}
            disabled={llmTest.isPending}
            className="px-3 py-1.5 bg-secondary hover:bg-secondary/70 disabled:opacity-50 rounded-lg text-sm flex items-center gap-1.5 transition"
          >
            {llmTest.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
            测试 LLM 连接
          </button>
          {llmTest.data && (
            <span className={`text-xs ${llmTest.data.success ? 'text-ok' : 'text-danger'}`}>
              {llmTest.data.success ? `响应: ${(llmTest.data.data as Record<string, unknown>)?.response?.slice(0, 40)}` : (llmTest.data.error as Record<string, string>)?.message}
            </span>
          )}
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
        {mediaMutation.data?.success && (mediaMutation.data.data as Record<string, unknown>)?.outputUrl && (
          <a href={(mediaMutation.data.data as Record<string, unknown>).outputUrl as string} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline break-all">
            查看结果
          </a>
        )}
        {mediaMutation.data && !mediaMutation.data.success && (
          <div className="text-xs text-danger">{(mediaMutation.data.error as Record<string, string>)?.message}</div>
        )}
      </div>
    </div>
  )
}
