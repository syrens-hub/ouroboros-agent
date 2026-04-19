import { create } from 'zustand'
import { apiFetch, wsUrl } from '../api'
import { compressImage } from '../utils/image'
import { useSessionStore } from './sessionStore'
import type {
  ContentBlock,
  Message,
  Tool,
  ConfirmModalState,
  ReviewNotice,
  TraceEvent,
  AttachedFile,
} from '../types/chat'

let wsInstance: WebSocket | null = null

function closeWs() {
  if (wsInstance) {
    wsInstance.close()
    wsInstance = null
  }
}

async function uploadFile(file: File, sessionId: string, type = 'image'): Promise<{ url: string; name: string }> {
  const formData = new FormData()
  formData.append('file', file)
  const endpoint = type === 'image' ? `/api/upload?sessionId=${sessionId}` : `/api/upload/file?sessionId=${sessionId}`
  const res = await apiFetch(endpoint, {
    method: 'POST',
    body: formData,
    headers: {},
  })
  const data = (await res.json()) as { success?: boolean; data?: { url: string; name?: string }; error?: string }
  if (data.success) return { url: data.data!.url, name: data.data!.name || file.name }
  throw new Error(data.error || 'Upload failed')
}

export interface ChatState {
  messages: Message[]
  isLoading: boolean
  isTyping: boolean
  inputValue: string
  skillPanelOpen: boolean
  error: string | null
  hasMore: boolean
  loadingMore: boolean
  attachedFiles: AttachedFile[]
  tools: Tool[]
  confirmModal: ConfirmModalState | null
  reviewNotices: ReviewNotice[]
  traceDrawerOpen: boolean
  traceEvents: TraceEvent[]
  traceLoading: boolean
  lightboxUrl: string | null
  ttsSpeakingId: number | null
  isListening: boolean
  voiceLang: string
  voiceContinuous: boolean

  // Actions
  setMessages: (messages: Message[]) => void
  addMessage: (message: Message) => void
  updateMessage: (id: string, updates: Partial<Message>) => void
  removeMessage: (id: string) => void
  setLoading: (loading: boolean) => void
  setTyping: (typing: boolean) => void
  setInputValue: (value: string) => void
  toggleSkillPanel: () => void
  setError: (error: string | null) => void
  setHasMore: (hasMore: boolean) => void
  setLoadingMore: (loadingMore: boolean) => void
  setAttachedFiles: (files: AttachedFile[]) => void
  setTools: (tools: Tool[]) => void
  setConfirmModal: (modal: ConfirmModalState | null) => void
  addReviewNotice: (notice: ReviewNotice) => void
  dismissReviewNotice: (id: number) => void
  setTraceDrawerOpen: (open: boolean) => void
  setTraceEvents: (events: TraceEvent[]) => void
  setTraceLoading: (loading: boolean) => void
  setLightboxUrl: (url: string | null) => void
  setTtsSpeakingId: (id: number | null) => void
  setIsListening: (listening: boolean) => void
  setVoiceLang: (lang: string) => void
  setVoiceContinuous: (continuous: boolean) => void

  sendMessage: (content: string) => Promise<void>
  loadSessionHistory: (sessionId: string) => Promise<void>
  loadMoreMessages: () => Promise<void>
  loadTraces: (sessionId: string) => Promise<void>
  handleConfirm: (allowed: boolean) => void

  attachImage: (file: File, sessionId: string) => Promise<void>
  attachFile: (file: File, sessionId: string) => Promise<void>
  removeAttachedFile: (index: number) => void

  speakText: (text: string, id: number) => void
  stopSpeaking: () => void

  handleDragOver: (e: React.DragEvent) => void
  handleDrop: (e: React.DragEvent, sessionId: string) => void
  handlePaste: (e: React.ClipboardEvent, sessionId: string) => void
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>, sessionId: string) => void
  handleCameraSelect: (e: React.ChangeEvent<HTMLInputElement>, sessionId: string) => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isLoading: false,
  isTyping: false,
  inputValue: '',
  skillPanelOpen: true,
  error: null,
  hasMore: false,
  loadingMore: false,
  attachedFiles: [],
  tools: [],
  confirmModal: null,
  reviewNotices: [],
  traceDrawerOpen: false,
  traceEvents: [],
  traceLoading: false,
  lightboxUrl: null,
  ttsSpeakingId: null,
  isListening: false,
  voiceLang: 'zh-CN',
  voiceContinuous: false,

  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  updateMessage: (id, updates) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id || m.messageId === id ? { ...m, ...updates } : m)),
    })),
  removeMessage: (id) =>
    set((state) => ({
      messages: state.messages.filter((m) => m.id !== id && m.messageId !== id),
    })),
  setLoading: (loading) => set({ isLoading: loading }),
  setTyping: (typing) => set({ isTyping: typing }),
  setInputValue: (value) => set({ inputValue: value }),
  toggleSkillPanel: () => set((state) => ({ skillPanelOpen: !state.skillPanelOpen })),
  setError: (error) => set({ error }),
  setHasMore: (hasMore) => set({ hasMore }),
  setLoadingMore: (loadingMore) => set({ loadingMore }),
  setAttachedFiles: (files) => set({ attachedFiles: files }),
  setTools: (tools) => set({ tools }),
  setConfirmModal: (modal) => set({ confirmModal: modal }),
  addReviewNotice: (notice) => {
    set((state) => ({ reviewNotices: [...state.reviewNotices, notice] }))
    setTimeout(() => {
      set((state) => ({ reviewNotices: state.reviewNotices.filter((n) => n.id !== notice.id) }))
    }, 8000)
  },
  dismissReviewNotice: (id) =>
    set((state) => ({ reviewNotices: state.reviewNotices.filter((n) => n.id !== id) })),
  setReviewNotices: (notices) => set({ reviewNotices: notices }),
  setTraceDrawerOpen: (open) => set({ traceDrawerOpen: open }),
  setTraceEvents: (events) => set({ traceEvents: events }),
  setTraceLoading: (loading) => set({ traceLoading: loading }),
  setLightboxUrl: (url) => set({ lightboxUrl: url }),
  setTtsSpeakingId: (id) => set({ ttsSpeakingId: id }),
  setIsListening: (listening) => set({ isListening: listening }),
  setVoiceLang: (lang) => set({ voiceLang: lang }),
  setVoiceContinuous: (continuous) => set({ voiceContinuous: continuous }),

  sendMessage: async (content: string) => {
    const state = get()
    const sessionId = useSessionStore.getState().currentSessionId
    if ((!content.trim() && state.attachedFiles.length === 0) || !sessionId || state.isLoading) return

    const text = content.trim()
    const files = state.attachedFiles
    set({ inputValue: '', attachedFiles: [], isLoading: true, tools: [] })

    const contentBlocks: ContentBlock[] = []
    if (text) contentBlocks.push({ type: 'text', text })
    files.forEach((f) => {
      if (f.type === 'image' && f.serverUrl) {
        contentBlocks.push({ type: 'image_url', image_url: { url: f.serverUrl } })
      } else if (f.type === 'file' && f.serverUrl) {
        contentBlocks.push({ type: 'text', text: `[附件: ${f.name}](${f.serverUrl})` })
      }
    })

    const messageContent: string | ContentBlock[] =
      contentBlocks.length > 1 || (contentBlocks.length === 1 && contentBlocks[0].type !== 'text')
        ? contentBlocks
        : text

    // Optimistically add user message
    set((s) => ({
      messages: [...s.messages, { role: 'user', content: messageContent, timestamp: Date.now() }],
    }))

    closeWs()
    const { url, protocols } = wsUrl(sessionId)
    const ws = new WebSocket(url, protocols)
    wsInstance = ws

    ws.onopen = () => {
      if (Array.isArray(messageContent)) {
        ws.send(JSON.stringify({ type: 'chat', content: messageContent }))
      } else {
        ws.send(JSON.stringify({ type: 'chat', message: text }))
      }
    }

    ws.onmessage = (e) => {
      try {
        const { event, data } = JSON.parse(e.data) as { event: string; data: Record<string, unknown> }
        const evt = {
          event,
          ...(typeof data === 'object' && data !== null ? data : {}),
        } as Record<string, unknown>

        if (evt.event === 'assistant') {
          set((s) => {
            const prev = s.messages
            const last = prev[prev.length - 1]
            if (last && last.role === 'assistant' && last._streaming) {
              const updated = [...prev]
              updated[updated.length - 1] = {
                ...last,
                content:
                  (typeof last.content === 'string' ? last.content : '') + ((evt.content as string) || ''),
                timestamp: Date.now(),
              }
              return { messages: updated }
            }
            return {
              messages: [
                ...prev,
                { role: 'assistant', content: (evt.content as string) || '', timestamp: Date.now(), _streaming: true },
              ],
            }
          })
        } else if (evt.event === 'tool_start') {
          set((s) => ({
            tools: [...s.tools, { id: evt.toolUseId as string, name: evt.name as string, input: evt.input, result: null }],
          }))
          if (evt.name === 'computer_use') {
            set((s) => ({
              messages: [
                ...s.messages,
                {
                  role: 'computer_use',
                  content: JSON.stringify({ _running: true, _steps: [], toolUseId: evt.toolUseId }),
                  timestamp: Date.now(),
                  name: evt.toolUseId as string,
                },
              ],
            }))
          }
        } else if (evt.event === 'tool_result') {
          set((s) => ({
            tools: s.tools.map((t) =>
              t.id === evt.toolUseId ? { ...t, result: evt.content as string, isError: evt.isError as boolean } : t
            ),
          }))
          if (evt.toolUseId) {
            set((s) => {
              const prev = s.messages
              const idx = prev.findLastIndex((m) => m.role === 'computer_use' && m.name === evt.toolUseId)
              if (idx >= 0) {
                try {
                  const existing = JSON.parse((prev[idx].content as string) || '{}') as import('../types/chat').ComputerUseData
                  const final = JSON.parse((evt.content as string) || '{}') as import('../types/chat').ComputerUseData
                  const updated: import('../types/chat').ComputerUseData = {
                    ...existing,
                    ...final,
                    _running: false,
                    toolUseId: evt.toolUseId as string,
                  }
                  const next = [...prev]
                  next[idx] = { ...prev[idx], content: JSON.stringify(updated) }
                  return { messages: next }
                } catch {
                  // fallback
                }
              }
              return {
                messages: [
                  ...prev,
                  { role: 'tool_result', content: (evt.content as string) || '', timestamp: Date.now(), name: evt.toolUseId as string },
                ],
              }
            })
          } else {
            set((s) => ({
              messages: [
                ...s.messages,
                { role: 'tool_result', content: (evt.content as string) || '', timestamp: Date.now(), name: evt.toolUseId as string },
              ],
            }))
          }
        } else if (evt.event === 'progress') {
          if (evt.toolName === 'computer_use' && evt.toolUseId) {
            set((s) => {
              const prev = s.messages
              const idx = prev.findLastIndex((m) => m.role === 'computer_use' && m.name === evt.toolUseId)
              if (idx >= 0) {
                try {
                  const data = JSON.parse((prev[idx].content as string) || '{}') as import('../types/chat').ComputerUseData
                  const steps = Array.isArray(data._steps) ? data._steps : []
                  steps.push({
                    step: evt.step as number | string,
                    message: evt.message as string,
                    detail: evt.detail as import('../types/chat').ComputerUseStep['detail'],
                  })
                  const updated = { ...data, _steps: steps }
                  const next = [...prev]
                  next[idx] = { ...prev[idx], content: JSON.stringify(updated) }
                  return { messages: next }
                } catch {
                  return s
                }
              }
              return s
            })
          } else {
            set((s) => ({
              messages: [
                ...s.messages,
                {
                  role: 'system',
                  content: `⏳ ${evt.toolName} [${evt.step}${evt.totalSteps ? `/${evt.totalSteps}` : ''}]: ${evt.message}`,
                  timestamp: Date.now(),
                },
              ],
            }))
          }
        } else if (evt.event === 'confirm_request') {
          set({ confirmModal: { toolName: evt.toolName as string, input: evt.input, timeoutMs: evt.timeoutMs as number } })
        } else if (evt.event === 'done') {
          set({ isLoading: false })
          set((s) => {
            const prev = s.messages
            const last = prev[prev.length - 1]
            if (last && last._streaming) {
              const updated = [...prev]
              updated[updated.length - 1] = { ...last, _streaming: false }
              return { messages: updated }
            }
            return s
          })
          closeWs()
        } else if (evt.event === 'error') {
          set({ isLoading: false })
          set((s) => ({
            messages: [
              ...s.messages,
              { role: 'system', content: `Error: ${evt.message || 'Unknown'}`, timestamp: Date.now() },
            ],
          }))
          closeWs()
        }
      } catch {
        // ignore
      }
    }

    ws.onerror = () => {
      set({ isLoading: false })
      closeWs()
    }
  },

  loadSessionHistory: async (sessionId: string) => {
    if (!sessionId) {
      set({ messages: [], hasMore: false, attachedFiles: [] })
      return
    }
    set({ loadingMore: false })
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}/messages`)
      const data = (await res.json()) as { success?: boolean; data?: Message[] }
      if (data.success) {
        set({ messages: data.data || [], hasMore: (data.data || []).length >= 20 })
      }
    } catch {
      set({ messages: [], hasMore: false })
    }
  },

  loadMoreMessages: async () => {
    const { messages, hasMore, loadingMore } = get()
    const sessionId = useSessionStore.getState().currentSessionId
    if (!hasMore || loadingMore || !sessionId) return
    const firstMessageId = messages[0]?.id || messages[0]?.messageId
    if (!firstMessageId) return
    set({ loadingMore: true })
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}/messages?beforeId=${firstMessageId}&limit=20`)
      const data = (await res.json()) as { success?: boolean; data?: Message[] }
      if (data.success) {
        const older = data.data || []
        set((s) => ({ messages: [...older, ...s.messages], hasMore: older.length >= 20 }))
      } else {
        set({ hasMore: false })
      }
    } catch {
      set({ hasMore: false })
    } finally {
      set({ loadingMore: false })
    }
  },

  loadTraces: async (sessionId: string) => {
    if (!sessionId) return
    set({ traceLoading: true })
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}/traces`)
      const data = (await res.json()) as { success?: boolean; data?: TraceEvent[] }
      if (data.success) set({ traceEvents: data.data || [] })
    } catch {
      set({ traceEvents: [] })
    } finally {
      set({ traceLoading: false })
    }
  },

  handleConfirm: (allowed: boolean) => {
    const { confirmModal } = get()
    const sessionId = useSessionStore.getState().currentSessionId
    if (!confirmModal || !sessionId || !wsInstance) return
    wsInstance.send(JSON.stringify({ type: 'confirm', allowed }))
    set({ confirmModal: null })
  },

  attachImage: async (file: File, sessionId: string) => {
    const id = URL.createObjectURL(file)
    set((state) => ({
      attachedFiles: [...state.attachedFiles, { id, previewUrl: id, name: file.name, type: 'image', uploading: true }],
    }))
    try {
      const compressed = await compressImage(file, 1920, 0.85)
      const { url } = await uploadFile(compressed, sessionId, 'image')
      set((state) => ({
        attachedFiles: state.attachedFiles.map((f) => (f.id === id ? { ...f, serverUrl: url, uploading: false } : f)),
      }))
    } catch {
      set((state) => ({ attachedFiles: state.attachedFiles.filter((f) => f.id !== id) }))
    }
  },

  attachFile: async (file: File, sessionId: string) => {
    const id = `${Date.now()}-${Math.random()}`
    set((state) => ({
      attachedFiles: [...state.attachedFiles, { id, name: file.name, type: 'file', size: file.size, uploading: true }],
    }))
    try {
      const { url } = await uploadFile(file, sessionId, 'file')
      set((state) => ({
        attachedFiles: state.attachedFiles.map((f) => (f.id === id ? { ...f, serverUrl: url, uploading: false } : f)),
      }))
    } catch {
      set((state) => ({ attachedFiles: state.attachedFiles.filter((f) => f.id !== id) }))
    }
  },

  removeAttachedFile: (index: number) => {
    set((state) => ({ attachedFiles: state.attachedFiles.filter((_, i) => i !== index) }))
  },

  speakText: (text: string, id: number) => {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = get().voiceLang
    utter.onstart = () => set({ ttsSpeakingId: id })
    utter.onend = () => set((state) => ({ ttsSpeakingId: state.ttsSpeakingId === id ? null : state.ttsSpeakingId }))
    utter.onerror = () => set((state) => ({ ttsSpeakingId: state.ttsSpeakingId === id ? null : state.ttsSpeakingId }))
    window.speechSynthesis.speak(utter)
  },

  stopSpeaking: () => {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()
    set({ ttsSpeakingId: null })
  },

  handleDragOver: (e: React.DragEvent) => {
    e.preventDefault()
  },

  handleDrop: (e: React.DragEvent, sessionId: string) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files)

    const textFiles = files.filter((f) => /\.(md|txt|json)$/i.test(f.name))
    textFiles.forEach((file) => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const content = ev.target?.result as string
        set((state) => ({ inputValue: `[文件名: ${file.name}]\n${content}\n---\n${state.inputValue}` }))
      }
      reader.readAsText(file)
    })

    const imageFiles = files.filter((f) => /^image\//i.test(f.type))
    const otherFiles = files.filter((f) => !/^image\//i.test(f.type) && !/\.(md|txt|json)$/i.test(f.name))

    imageFiles.forEach((file) => get().attachImage(file, sessionId))
    otherFiles.forEach((file) => get().attachFile(file, sessionId))
  },

  handlePaste: (e: React.ClipboardEvent, sessionId: string) => {
    const items = e.clipboardData?.items
    if (!items) return
    const imageFiles: File[] = []
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile()
        if (file) imageFiles.push(file)
      }
    }
    if (imageFiles.length > 0 && sessionId) {
      e.preventDefault()
      imageFiles.forEach((file) => get().attachImage(file, sessionId))
    }
  },

  handleFileSelect: async (e: React.ChangeEvent<HTMLInputElement>, sessionId: string) => {
    const files = Array.from(e.target.files || [])
    for (const file of files) {
      if (/^image\//i.test(file.type)) {
        await get().attachImage(file, sessionId)
      } else if (/\.(md|txt|json)$/i.test(file.name)) {
        const reader = new FileReader()
        reader.onload = (ev) => {
          const content = ev.target?.result as string
          set((state) => ({ inputValue: `[文件名: ${file.name}]\n${content}\n---\n${state.inputValue}` }))
        }
        reader.readAsText(file)
      } else {
        await get().attachFile(file, sessionId)
      }
    }
    e.target.value = ''
  },

  handleCameraSelect: async (e: React.ChangeEvent<HTMLInputElement>, sessionId: string) => {
    const file = e.target.files?.[0]
    if (file) await get().attachImage(file, sessionId)
    e.target.value = ''
  },
}))
