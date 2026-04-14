import { useEffect, useRef, useState, useCallback, lazy, Suspense } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  MessageSquare,
  Send,
  Plus,
  Wrench,
  Cpu,
  CheckCircle,
  XCircle,
  Loader2,
  AlertCircle,
  Trash2,
  X,
  Sparkles,
  Mic,
  MicOff,
  Image as ImageIcon,
  Globe,
  Volume2,
  Camera,
  Paperclip,
  FileText,
  Monitor,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { useWebSocket } from '../hooks/useWebSocket'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { apiFetch, wsUrl } from '../api.js'
import { compressImage } from '../utils/image.js'

const CodeBlock = lazy(() => import('./CodeBlock'))

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function classForRole(role) {
  if (role === 'user')
    return 'bg-gradient-to-br from-accent/30 to-accent/10 text-white border border-accent/30 shadow-lg shadow-accent/10'
  if (role === 'assistant')
    return 'bg-gradient-to-br from-card to-secondary/30 border border-white/10 shadow-[0_4px_24px_rgba(0,0,0,0.35)]'
  if (role === 'tool_result') return 'bg-secondary/30 text-muted border border-white/5'
  if (role === 'computer_use') return 'bg-secondary/20 border border-accent/20'
  return 'bg-card border border-border'
}

function ComputerUseCard({ data, onImageClick }) {
  const [open, setOpen] = useState(true)
  const isRunning = data._running === true
  const steps = Array.isArray(data._steps) ? data._steps : []
  return (
    <div className="rounded-lg border border-white/10 bg-secondary/30 overflow-hidden min-w-[16rem]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-secondary/50 transition"
      >
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          <Monitor className="w-4 h-4 text-accent" />
          <span>Computer Use</span>
          {isRunning ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/20 text-accent">
              {data.stepsTaken ?? steps.length} 步
            </span>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted" /> : <ChevronDown className="w-4 h-4 text-muted" />}
      </button>
      {open && (
        <div className="px-3 pb-3 text-xs text-muted space-y-2">
          <div>
            <span className="text-white/70 font-medium">目标：</span>
            <span className="text-white">{data.goal}</span>
          </div>
          {!isRunning && data.summary && (
            <div>
              <span className="text-white/70 font-medium">结果：</span>
              <span className="text-white">{data.summary}</span>
            </div>
          )}
          {steps.length > 0 && (
            <div className="space-y-2">
              <span className="text-white/70 font-medium">执行记录：</span>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {steps.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 rounded border border-white/5 bg-black/20 p-2">
                    <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/20 text-[10px] text-accent font-bold">
                      {s.step}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-white/90 truncate">{s.message}</div>
                      {s.detail?.screenshotUrl && (
                        <img
                          src={s.detail.screenshotUrl}
                          alt={`step ${s.step}`}
                          className="mt-1 max-w-[8rem] rounded border border-white/10 cursor-zoom-in"
                          onClick={() => onImageClick && onImageClick(s.detail.screenshotUrl)}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!isRunning && data.finalScreenshotUrl && (
            <div>
              <span className="text-white/70 font-medium block mb-1">最终截图：</span>
              <img
                src={data.finalScreenshotUrl}
                alt="final screenshot"
                className="max-w-xs rounded-lg border border-white/10 cursor-zoom-in"
                onClick={() => onImageClick && onImageClick(data.finalScreenshotUrl)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MessageContent({ msg, onImageClick }) {
  const blocks = (() => {
    if (typeof msg.content === 'string') {
      try {
        const parsed = JSON.parse(msg.content)
        if (Array.isArray(parsed)) return parsed
      } catch {
        // ignore
      }
      return [{ type: 'text', text: msg.content }]
    }
    if (Array.isArray(msg.content)) {
      return msg.content
    }
    return [{ type: 'text', text: JSON.stringify(msg.content) }]
  })()

  const textBlocks = blocks
    .map((b) => {
      if (b.type === 'text') return b.text
      if (b.type === 'tool_use') return `[调用工具: ${b.name}]`
      return ''
    })
    .filter(Boolean)
    .join('\n')

  const thinkMatch = textBlocks.match(/<think>([\s\S]*?)<\/think>/)
  const thinkContent = thinkMatch ? thinkMatch[1].trim() : ''
  const mainContent = thinkContent ? textBlocks.replace(/<think>[\s\S]*?<\/think>/, '').trim() : textBlocks

  const imageBlocks = blocks.filter((b) => b.type === 'image_url' && b.image_url?.url)

  let computerUseData = null
  try {
    const parsed = JSON.parse(textBlocks)
    if (parsed && (parsed._running === true || (parsed.success && Array.isArray(parsed.history) && typeof parsed.stepsTaken === 'number'))) {
      computerUseData = parsed
    }
  } catch {
    // ignore
  }

  if (msg.role === 'computer_use' || computerUseData) {
    return <ComputerUseCard data={computerUseData || { _running: true, _steps: [] }} onImageClick={onImageClick} />
  }

  if (msg.role !== 'assistant') {
    return (
      <div className="whitespace-pre-wrap">
        {textBlocks && <div className="whitespace-pre-wrap">{textBlocks}</div>}
        {imageBlocks.map((b, i) => (
          <img
            key={i}
            src={b.image_url.url}
            alt="uploaded"
            className="mt-2 max-w-xs rounded-lg border border-white/10 cursor-zoom-in"
            onClick={() => onImageClick && onImageClick(b.image_url.url)}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="prose prose-invert">
      {thinkContent && (
        <details className="mb-2 rounded border border-white/10 bg-secondary/30 text-sm">
          <summary className="cursor-pointer select-none px-3 py-2 text-muted hover:text-white">
            推理过程
          </summary>
          <pre className="m-0 overflow-auto whitespace-pre-wrap px-3 pb-3 text-xs text-muted">
            {thinkContent}
          </pre>
        </details>
      )}
      {(mainContent || !thinkContent) && (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            img({ src, alt, ...props }) {
              return (
                <img
                  src={src}
                  alt={alt}
                  {...props}
                  className="mt-2 max-w-xs rounded-lg border border-white/10 cursor-zoom-in"
                  onClick={() => onImageClick && onImageClick(src)}
                />
              )
            },
            code({ inline, className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || '')
              return !inline && match ? (
                <Suspense fallback={<div className="my-3 p-4 bg-secondary/30 rounded-lg text-xs text-muted">Loading code highlight...</div>}>
                  <CodeBlock language={match[1]}>{children}</CodeBlock>
                </Suspense>
              ) : (
                <code className={className} {...props}>
                  {children}
                </code>
              )
            },
          }}
        >
          {mainContent || textBlocks}
        </ReactMarkdown>
      )}
      {imageBlocks.map((b, i) => (
        <img
          key={i}
          src={b.image_url.url}
          alt="uploaded"
          className="mt-2 max-w-xs rounded-lg border border-white/10 cursor-zoom-in"
          onClick={() => onImageClick && onImageClick(b.image_url.url)}
        />
      ))}
    </div>
  )
}

async function uploadFile(file, sessionId, type = 'image') {
  const formData = new FormData()
  formData.append('file', file)
  const endpoint = type === 'image' ? `/api/upload?sessionId=${sessionId}` : `/api/upload/file?sessionId=${sessionId}`
  const res = await apiFetch(endpoint, {
    method: 'POST',
    body: formData,
    headers: {},
  })
  const data = await res.json()
  if (data.success) return { url: data.data.url, name: data.data.name || file.name }
  throw new Error(data.error || 'Upload failed')
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

export function ChatView({ sessions, systemStatus }) {
  const queryClient = useQueryClient()
  const [activeSessionId, setActiveSessionId] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [tools, setTools] = useState([])
  const [confirmModal, setConfirmModal] = useState(null)
  const [reviewNotices, setReviewNotices] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState([])
  const [isListening, setIsListening] = useState(false)
  const [voiceLang, setVoiceLang] = useState('zh-CN')
  const [voiceContinuous, setVoiceContinuous] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState(null)
  const [ttsSpeakingId, setTtsSpeakingId] = useState(null)
  const bottomRef = useRef(null)
  const messagesContainerRef = useRef(null)
  const { connect, close, send } = useWebSocket()
  const recognitionRef = useRef(null)

  // TTS
  const speakText = useCallback((text, id) => {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = voiceLang
    utter.onstart = () => setTtsSpeakingId(id)
    utter.onend = () => setTtsSpeakingId((curr) => (curr === id ? null : curr))
    utter.onerror = () => setTtsSpeakingId((curr) => (curr === id ? null : curr))
    window.speechSynthesis.speak(utter)
  }, [voiceLang])

  const stopSpeaking = useCallback(() => {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()
    setTtsSpeakingId(null)
  }, [])

  // SpeechRecognition setup
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return
    const rec = new SpeechRecognition()
    rec.lang = voiceLang
    rec.continuous = voiceContinuous
    rec.interimResults = voiceContinuous
    rec.onresult = (event) => {
      let transcript = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          transcript += event.results[i][0].transcript
        }
      }
      if (transcript) {
        setInput((prev) => prev + (prev ? ' ' : '') + transcript)
      }
      if (!voiceContinuous) {
        setIsListening(false)
      }
    }
    rec.onerror = () => setIsListening(false)
    rec.onend = () => {
      if (!voiceContinuous) setIsListening(false)
    }
    recognitionRef.current = rec
  }, [voiceLang, voiceContinuous])

  const toggleVoice = useCallback(() => {
    if (!recognitionRef.current) return
    if (isListening) {
      recognitionRef.current.stop()
      setIsListening(false)
    } else {
      try {
        recognitionRef.current.start()
        setIsListening(true)
      } catch {
        // ignore
      }
    }
  }, [isListening])

  // Lightbox Escape handler
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') setLightboxUrl(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Listen to WebSocket for background review decisions on the active session
  useEffect(() => {
    if (!activeSessionId) {
      setReviewNotices([])
      return
    }
    const ws = new WebSocket(wsUrl(activeSessionId))
    ws.onmessage = (e) => {
      try {
        const { event, data } = JSON.parse(e.data)
        if (event === 'notification' && data.type === 'review_decision' && data.meta?.sessionId === activeSessionId) {
          const id = Date.now() + Math.random()
          setReviewNotices((prev) => [...prev, { id, ...data }])
          setTimeout(() => {
            setReviewNotices((prev) => prev.filter((n) => n.id !== id))
          }, 8000)
        }
      } catch {
        // ignore
      }
    }
    return () => ws.close()
  }, [activeSessionId])

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Load messages when switching session
  useEffect(() => {
    if (!activeSessionId) {
      setMessages([])
      setHasMore(false)
      setAttachedFiles([])
      return
    }
    setLoadingMore(false)
    apiFetch(`/api/sessions/${activeSessionId}/messages`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setMessages(data.data || [])
          setHasMore((data.data || []).length >= 20)
        }
      })
      .catch(() => {
        setMessages([])
        setHasMore(false)
      })
  }, [activeSessionId])

  // Message pagination on scroll-up
  useEffect(() => {
    const el = messagesContainerRef.current
    if (!el) return
    const onScroll = () => {
      if (el.scrollTop < 50 && hasMore && !loadingMore) {
        const firstMessageId = messages[0]?.id || messages[0]?.messageId
        if (firstMessageId) {
          setLoadingMore(true)
          apiFetch(`/api/sessions/${activeSessionId}/messages?beforeId=${firstMessageId}&limit=20`)
            .then((r) => r.json())
            .then((data) => {
              if (data.success) {
                const older = data.data || []
                setMessages((prev) => [...older, ...prev])
                setHasMore(older.length >= 20)
              } else {
                setHasMore(false)
              }
            })
            .catch(() => setHasMore(false))
            .finally(() => setLoadingMore(false))
        }
      }
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [messages, hasMore, loadingMore, activeSessionId])

  const handleNewSession = useCallback(async () => {
    const res = await apiFetch('/api/sessions', { method: 'POST' })
    const data = await res.json()
    if (data.success) {
      setActiveSessionId(data.data.sessionId)
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
    }
  }, [queryClient])

  const handleDeleteSession = useCallback(
    async (id) => {
      await apiFetch(`/api/sessions/${id}`, { method: 'DELETE' })
      if (activeSessionId === id) setActiveSessionId(null)
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
    },
    [activeSessionId, queryClient]
  )

  const handleSend = useCallback(() => {
    if ((!input.trim() && attachedFiles.length === 0) || !activeSessionId || loading) return
    const text = input.trim()
    const files = attachedFiles
    setInput('')
    setAttachedFiles([])
    setLoading(true)
    setTools([])

    const contentBlocks = []
    if (text) contentBlocks.push({ type: 'text', text })
    files.forEach((f) => {
      if (f.type === 'image' && f.serverUrl) {
        contentBlocks.push({ type: 'image_url', image_url: { url: f.serverUrl } })
      } else if (f.type === 'file' && f.serverUrl) {
        contentBlocks.push({ type: 'text', text: `[附件: ${f.name}](${f.serverUrl})` })
      }
    })

    const content = contentBlocks.length > 1 || (contentBlocks.length === 1 && contentBlocks[0].type !== 'text') ? contentBlocks : text

    // Optimistically add user message
    setMessages((prev) => [...prev, { role: 'user', content, timestamp: Date.now() }])

    connect(activeSessionId, {
      onOpen: () => {
        if (Array.isArray(content)) {
          send({ type: 'chat', content })
        } else {
          send({ type: 'chat', message: text })
        }
      },
      onEvent: (evt) => {
        if (evt.event === 'assistant') {
          setMessages((prev) => {
            const last = prev[prev.length - 1]
            if (last && last.role === 'assistant' && last._streaming) {
              const updated = [...prev]
              updated[updated.length - 1] = {
                ...last,
                content: last.content + (evt.content || ''),
                timestamp: Date.now(),
              }
              return updated
            }
            return [...prev, { role: 'assistant', content: evt.content || '', timestamp: Date.now(), _streaming: true }]
          })
        } else if (evt.event === 'tool_start') {
          setTools((prev) => [...prev, { id: evt.toolUseId, name: evt.name, input: evt.input, result: null }])
          if (evt.name === 'computer_use') {
            setMessages((prev) => [
              ...prev,
              { role: 'computer_use', content: JSON.stringify({ _running: true, _steps: [], toolUseId: evt.toolUseId }), timestamp: Date.now(), name: evt.toolUseId },
            ])
          }
        } else if (evt.event === 'tool_result') {
          setTools((prev) =>
            prev.map((t) => (t.id === evt.toolUseId ? { ...t, result: evt.content, isError: evt.isError } : t))
          )
          if (evt.toolUseId) {
            setMessages((prev) => {
              const idx = prev.findLastIndex((m) => m.role === 'computer_use' && m.name === evt.toolUseId)
              if (idx >= 0) {
                try {
                  const existing = JSON.parse(prev[idx].content || '{}')
                  const final = JSON.parse(evt.content || '{}')
                  const updated = {
                    ...existing,
                    ...final,
                    _running: false,
                    toolUseId: evt.toolUseId,
                  }
                  const next = [...prev]
                  next[idx] = { ...prev[idx], content: JSON.stringify(updated) }
                  return next
                } catch {
                  // fallback
                }
              }
              return [...prev, { role: 'tool_result', content: evt.content || '', timestamp: Date.now(), name: evt.toolUseId }]
            })
          } else {
            setMessages((prev) => [
              ...prev,
              { role: 'tool_result', content: evt.content || '', timestamp: Date.now(), name: evt.toolUseId },
            ])
          }
        } else if (evt.event === 'progress') {
          if (evt.toolName === 'computer_use' && evt.toolUseId) {
            setMessages((prev) => {
              const idx = prev.findLastIndex((m) => m.role === 'computer_use' && m.name === evt.toolUseId)
              if (idx >= 0) {
                try {
                  const data = JSON.parse(prev[idx].content || '{}')
                  const steps = Array.isArray(data._steps) ? data._steps : []
                  steps.push({ step: evt.step, message: evt.message, detail: evt.detail })
                  const updated = { ...data, _steps: steps }
                  const next = [...prev]
                  next[idx] = { ...prev[idx], content: JSON.stringify(updated) }
                  return next
                } catch {
                  return prev
                }
              }
              return prev
            })
          } else {
            setMessages((prev) => [
              ...prev,
              { role: 'system', content: `⏳ ${evt.toolName} [${evt.step}${evt.totalSteps ? `/${evt.totalSteps}` : ''}]: ${evt.message}`, timestamp: Date.now() },
            ])
          }
        } else if (evt.event === 'confirm_request') {
          setConfirmModal({ toolName: evt.toolName, input: evt.input, timeoutMs: evt.timeoutMs })
        } else if (evt.event === 'done') {
          setLoading(false)
          setMessages((prev) => {
            const last = prev[prev.length - 1]
            if (last && last._streaming) {
              const updated = [...prev]
              updated[updated.length - 1] = { ...last, _streaming: false }
              return updated
            }
            return prev
          })
          close()
        } else if (evt.event === 'error') {
          setLoading(false)
          setMessages((prev) => [...prev, { role: 'system', content: `Error: ${evt.message || 'Unknown'}`, timestamp: Date.now() }])
          close()
        }
      },
      onError: () => {
        setLoading(false)
        close()
      },
    })
  }, [input, activeSessionId, loading, attachedFiles, connect, close, send])

  const handleConfirm = useCallback(
    (allowed) => {
      if (!confirmModal || !activeSessionId) return
      send({ type: 'confirm', allowed })
      setConfirmModal(null)
    },
    [confirmModal, activeSessionId, send]
  )

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
  }, [])

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault()
      const files = Array.from(e.dataTransfer.files)

      const textFiles = files.filter((f) => /\.(md|txt|json)$/i.test(f.name))
      textFiles.forEach((file) => {
        const reader = new FileReader()
        reader.onload = (ev) => {
          const content = ev.target.result
          setInput((prev) => `[文件名: ${file.name}]\n${content}\n---\n${prev}`)
        }
        reader.readAsText(file)
      })

      const imageFiles = files.filter((f) => /^image\//i.test(f.type))
      const otherFiles = files.filter((f) => !/^image\//i.test(f.type) && !/\.(md|txt|json)$/i.test(f.name))

      imageFiles.forEach((file) => handleAttachImage(file))
      otherFiles.forEach((file) => handleAttachFile(file))
    },
    [activeSessionId]
  )

  const handlePaste = useCallback(
    (e) => {
      const items = e.clipboardData?.items
      if (!items) return
      const imageFiles = []
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile()
          if (file) imageFiles.push(file)
        }
      }
      if (imageFiles.length > 0 && activeSessionId) {
        e.preventDefault()
        imageFiles.forEach((file) => handleAttachImage(file))
      }
    },
    [activeSessionId]
  )

  async function handleAttachImage(file) {
    if (!activeSessionId) return
    const id = URL.createObjectURL(file)
    setAttachedFiles((prev) => [...prev, { id, previewUrl: id, name: file.name, type: 'image', uploading: true }])
    try {
      const compressed = await compressImage(file, 1920, 0.85)
      const { url } = await uploadFile(compressed, activeSessionId, 'image')
      setAttachedFiles((prev) => prev.map((f) => (f.id === id ? { ...f, serverUrl: url, uploading: false } : f)))
    } catch {
      setAttachedFiles((prev) => prev.filter((f) => f.id !== id))
    }
  }

  async function handleAttachFile(file) {
    if (!activeSessionId) return
    const id = `${Date.now()}-${Math.random()}`
    setAttachedFiles((prev) => [...prev, { id, name: file.name, type: 'file', size: file.size, uploading: true }])
    try {
      const { url } = await uploadFile(file, activeSessionId, 'file')
      setAttachedFiles((prev) => prev.map((f) => (f.id === id ? { ...f, serverUrl: url, uploading: false } : f)))
    } catch {
      setAttachedFiles((prev) => prev.filter((f) => f.id !== id))
    }
  }

  const handleFileSelect = useCallback(
    async (e) => {
      const files = Array.from(e.target.files || [])
      for (const file of files) {
        if (/^image\//i.test(file.type)) {
          await handleAttachImage(file)
        } else if (/\.(md|txt|json)$/i.test(file.name)) {
          const reader = new FileReader()
          reader.onload = (ev) => {
            const content = ev.target.result
            setInput((prev) => `[文件名: ${file.name}]\n${content}\n---\n${prev}`)
          }
          reader.readAsText(file)
        } else {
          await handleAttachFile(file)
        }
      }
      e.target.value = ''
    },
    [activeSessionId]
  )

  const handleCameraSelect = useCallback(
    async (e) => {
      const file = e.target.files?.[0]
      if (file) await handleAttachImage(file)
      e.target.value = ''
    },
    [activeSessionId]
  )

  const activeSession = sessions.find((s) => s.sessionId === activeSessionId)

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <img src={lightboxUrl} alt="Preview" className="max-w-full max-h-full rounded-lg shadow-2xl" />
        </div>
      )}

      {/* Left: Session List */}
      <div className="w-64 flex-shrink-0 bg-card border border-border rounded-xl p-4 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-text-strong flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-accent" />
            会话
          </h3>
          <button
            onClick={handleNewSession}
            className="p-1.5 rounded-lg bg-secondary hover:bg-secondary/70 transition hover:scale-105 active:scale-95"
            title="新建会话"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
          {sessions.map((s) => (
            <div
              key={s.sessionId}
              onClick={() => setActiveSessionId(s.sessionId)}
              className={`group cursor-pointer px-3 py-2.5 rounded-lg text-sm transition-all duration-200 flex items-center justify-between ${
                s.sessionId === activeSessionId
                  ? 'bg-accent text-white shadow-md shadow-accent/20'
                  : 'hover:bg-white/5 hover:translate-x-0.5 hover:shadow-sm'
              }`}
            >
              <span className="truncate flex-1">{s.title || s.sessionId}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleDeleteSession(s.sessionId)
                }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-danger/20 text-danger transition"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          {sessions.length === 0 && <div className="text-xs text-muted text-center py-8">暂无会话</div>}
        </div>
      </div>

      {/* Center: Chat */}
      <div className="flex-1 bg-card border border-border rounded-xl flex flex-col overflow-hidden relative">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between bg-card/80 backdrop-blur-sm z-10">
          <h2 className="text-sm font-semibold text-text-strong">
            {activeSession ? activeSession.title || activeSession.sessionId : '选择一个会话'}
          </h2>
          {loading && <Loader2 className="w-4 h-4 animate-spin text-accent" />}
        </div>

        {reviewNotices.length > 0 && (
          <div className="px-5 pt-3 space-y-2">
            {reviewNotices.map((n) => (
              <div
                key={n.id}
                className="review-banner relative flex items-start gap-3 rounded-xl px-4 py-3 text-sm animate-glow-pulse"
              >
                <div className="relative">
                  <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-accent animate-star-pulse" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white tracking-tight">{n.title}</span>
                    {n.meta?.action && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-white/10 text-white border border-white/10">
                        {n.meta.action}
                      </span>
                    )}
                  </div>
                  {n.message && <div className="text-sm text-white/80 mt-0.5">{n.message}</div>}
                </div>
                <button
                  onClick={() => setReviewNotices((prev) => prev.filter((x) => x.id !== n.id))}
                  className="text-white/60 hover:text-white transition"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div ref={messagesContainerRef} data-testid="messages-container" className="flex-1 overflow-y-auto p-5 space-y-4">
          {!activeSessionId && (
            <div className="h-full flex flex-col items-center justify-center text-muted">
              <Cpu className="w-12 h-12 mb-4 text-accent/50 animate-float" />
              <p>选择或创建一个会话开始对话</p>
            </div>
          )}
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm whitespace-pre-wrap animate-fade-in ${classForRole(m.role)} ${m.role === 'user' ? 'ml-auto rounded-br-md' : 'mr-auto rounded-bl-md'}`}
            >
              <div className={`flex items-center gap-2 mb-1.5 text-xs ${m.role === 'user' ? 'text-white/70' : 'text-muted'}`}>
                <span className="font-medium">{m.role === 'user' ? '你' : m.role === 'assistant' ? 'Ouroboros' : m.role === 'computer_use' ? 'Browser' : '工具'}</span>
                <span>{formatTime(m.timestamp)}</span>
                {m.role === 'assistant' && (
                  <button
                    onClick={() => {
                      if (ttsSpeakingId === idx) {
                        stopSpeaking()
                      } else {
                        const text = (typeof m.content === 'string' ? m.content : '')
                          .replace(/\[Image:.*?\]/g, '')
                          .replace(/!\[.*?\]\(.*?\)/g, '')
                          .replace(/\[附件:.*?\]\(.*?\)/g, '')
                        speakText(text.slice(0, 500), idx)
                      }
                    }}
                    className={`ml-1 p-0.5 rounded transition ${ttsSpeakingId === idx ? 'text-accent animate-pulse' : 'hover:text-accent'}`}
                    title="朗读"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <MessageContent msg={m} onImageClick={setLightboxUrl} />
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="sticky bottom-0 p-4 border-t border-border bg-card/80 backdrop-blur-md" onDragOver={handleDragOver} onDrop={handleDrop}>
          {attachedFiles.length > 0 && (
            <div className="flex gap-2 mb-2 overflow-x-auto">
              {attachedFiles.map((f, idx) => (
                <div key={idx} className="relative group flex-shrink-0">
                  {f.type === 'image' ? (
                    <img src={f.previewUrl} alt="" className="h-16 w-16 object-cover rounded-lg border border-white/10" />
                  ) : (
                    <div className="h-16 px-3 flex flex-col justify-center rounded-lg border border-white/10 bg-secondary/50 text-xs max-w-[12rem]">
                      <div className="flex items-center gap-1.5 truncate">
                        <FileText className="w-3.5 h-3.5 text-accent" />
                        <span className="truncate">{f.name}</span>
                      </div>
                      <div className="text-[10px] text-muted mt-0.5">{formatFileSize(f.size)}</div>
                    </div>
                  )}
                  {f.uploading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg">
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                    </div>
                  )}
                  <button
                    onClick={() => setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))}
                    className="absolute -top-1 -right-1 p-0.5 bg-danger rounded-full text-white opacity-0 group-hover:opacity-100 transition"
                    aria-label="移除附件"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 items-center">
            <div className="flex items-center gap-1">
              <button
                onClick={toggleVoice}
                disabled={!activeSessionId || loading || !recognitionRef.current}
                title={voiceContinuous ? '停止连续收听' : '语音输入'}
                className={`p-2.5 rounded-xl transition ${isListening ? 'bg-danger/20 text-danger' : 'bg-secondary/70 hover:bg-secondary text-text-strong'}`}
              >
                {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setVoiceLang((l) => (l === 'zh-CN' ? 'en-US' : 'zh-CN'))}
                title={`语音语言: ${voiceLang}`}
                className="p-2 rounded-lg bg-secondary/50 hover:bg-secondary text-[10px] font-bold text-text-strong transition"
              >
                <Globe className="w-3 h-3" />
              </button>
              <button
                onClick={() => setVoiceContinuous((c) => !c)}
                title={voiceContinuous ? '关闭连续模式' : '开启连续模式'}
                className={`p-2 rounded-lg text-[10px] font-bold transition ${voiceContinuous ? 'bg-accent text-white' : 'bg-secondary/50 hover:bg-secondary text-text-strong'}`}
              >
                CC
              </button>
            </div>
            <label
              className={`p-2.5 rounded-xl cursor-pointer transition ${!activeSessionId || loading ? 'opacity-50 cursor-not-allowed bg-secondary/70' : 'bg-secondary/70 hover:bg-secondary text-text-strong'}`}
              title="上传图片"
            >
              <ImageIcon className="w-4 h-4" />
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={handleFileSelect}
                disabled={!activeSessionId || loading}
              />
            </label>
            <label
              className={`p-2.5 rounded-xl cursor-pointer transition ${!activeSessionId || loading ? 'opacity-50 cursor-not-allowed bg-secondary/70' : 'bg-secondary/70 hover:bg-secondary text-text-strong'}`}
              title="拍照"
            >
              <Camera className="w-4 h-4" />
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleCameraSelect}
                disabled={!activeSessionId || loading}
              />
            </label>
            <label
              className={`p-2.5 rounded-xl cursor-pointer transition ${!activeSessionId || loading ? 'opacity-50 cursor-not-allowed bg-secondary/70' : 'bg-secondary/70 hover:bg-secondary text-text-strong'}`}
              title="上传文件"
            >
              <Paperclip className="w-4 h-4" />
              <input
                type="file"
                className="hidden"
                onChange={handleFileSelect}
                disabled={!activeSessionId || loading}
              />
            </label>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              onPaste={handlePaste}
              disabled={!activeSessionId || loading}
              placeholder={activeSessionId ? '输入消息...' : '请先选择会话'}
              className="flex-1 bg-secondary/70 border border-white/10 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-accent/50 focus:bg-secondary transition disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={!activeSessionId || loading || (!input.trim() && attachedFiles.length === 0)}
              className="px-5 py-2.5 bg-accent hover:bg-accent-hover disabled:bg-secondary rounded-xl text-white text-sm flex items-center gap-2 transition shadow-lg shadow-accent/20 hover:shadow-accent/30"
            >
              <Send className="w-4 h-4" />
              发送
            </button>
          </div>
        </div>
      </div>

      {/* Right: Inspector */}
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

      {/* Confirm Modal */}
      {confirmModal && (
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
      )}
    </div>
  )
}
