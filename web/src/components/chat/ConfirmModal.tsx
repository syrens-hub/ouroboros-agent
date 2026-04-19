import { AlertCircle } from 'lucide-react'
import { useChatStore } from '../../store/chatStore'

export function ConfirmModal() {
  const { confirmModal, handleConfirm } = useChatStore()
  if (!confirmModal) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-card border border-border rounded-xl p-6 w-[28rem]">
        <div className="flex items-center gap-2 mb-3 text-warn">
          <AlertCircle className="w-5 h-5" />
          <h3 className="text-base font-semibold text-text-strong">权限确认</h3>
        </div>
        <p className="text-sm text-muted mb-4">
          工具 <span className="text-accent font-medium">{confirmModal.toolName}</span> 请求执行，是否允许？
        </p>
        <div className="bg-secondary/50 rounded-lg p-3 text-xs text-muted mb-4 max-h-40 overflow-y-auto whitespace-pre-wrap">
          {JSON.stringify(confirmModal.input, null, 2)}
        </div>
        <div className="flex justify-end gap-3">
          <button onClick={() => handleConfirm(false)} className="px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/70 text-sm transition">
            拒绝
          </button>
          <button onClick={() => handleConfirm(true)} className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm transition">
            允许
          </button>
        </div>
      </div>
    </div>
  )
}
