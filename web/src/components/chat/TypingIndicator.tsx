import { useChatStore } from '../../store/chatStore'

export function TypingIndicator() {
  const { isLoading, messages } = useChatStore()
  const lastMessage = messages[messages.length - 1]
  const isStreaming = lastMessage?._streaming

  if (!isLoading || !isStreaming) return null

  return (
    <div className="px-5 py-2 text-xs text-muted flex items-center gap-2">
      <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
      正在输入...
    </div>
  )
}
