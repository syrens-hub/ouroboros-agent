import { Cpu, Wrench, CheckCircle, XCircle } from 'lucide-react'
import { useChatStore } from '../../store/chatStore'
import type { SystemStatus } from '../../types/chat'

interface SkillPanelProps {
  systemStatus?: SystemStatus
}

export function SkillPanel({ systemStatus }: SkillPanelProps) {
  const { tools } = useChatStore()

  return (
    <div className="w-80 flex-shrink-0 bg-card border border-border rounded-xl p-4 flex flex-col gap-4 overflow-y-auto">
      {/* Status */}
      <div>
        <h3 className="text-sm font-semibold text-text-strong mb-3 flex items-center gap-2">
          <Cpu className="w-4 h-4 text-accent" />
          系统状态
        </h3>
        <div className="space-y-2 text-xs">
          <div className="flex justify-between py-1 border-b border-border/50">
            <span className="text-muted">LLM</span>
            <span className={systemStatus?.llmProvider !== 'local' ? 'text-ok' : 'text-muted'}>
              {systemStatus?.llmProvider || 'local'} / {systemStatus?.llmModel || 'mock'}
            </span>
          </div>
          <div className="flex justify-between py-1 border-b border-border/50">
            <span className="text-muted">Daemon</span>
            <span className={systemStatus?.daemonRunning ? 'text-ok' : 'text-muted'}>
              {systemStatus?.daemonRunning ? '运行中' : '停止'}
            </span>
          </div>
          <div className="flex justify-between py-1 border-b border-border/50">
            <span className="text-muted">Skills</span>
            <span className="text-white font-mono">{systemStatus?.skillCount || 0}</span>
          </div>
        </div>
      </div>

      {/* Tools */}
      <div className="flex-1 min-h-0 flex flex-col">
        <h3 className="text-sm font-semibold text-text-strong mb-3 flex items-center gap-2">
          <Wrench className="w-4 h-4 text-accent" />
          工具调用
        </h3>
        <div className="overflow-y-auto space-y-2">
          {tools.length === 0 && <div className="text-xs text-muted text-center py-4">本轮暂无工具调用</div>}
          {tools.map((t) => (
            <div key={t.id} className="border border-border rounded-lg p-3 text-xs">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-accent">{t.name}</span>
                {t.result && (
                  <span className={`ml-auto ${t.isError ? 'text-danger' : 'text-ok'}`}>
                    {t.isError ? <XCircle className="w-3.5 h-3.5" /> : <CheckCircle className="w-3.5 h-3.5" />}
                  </span>
                )}
              </div>
              <div className="text-muted mb-1">输入: {JSON.stringify(t.input)}</div>
              {t.result !== null && (
                <div className="bg-secondary/50 rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap">
                  {t.result}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
