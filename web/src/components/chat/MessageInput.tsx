import { useEffect, useRef, useCallback } from 'react'
import {
  Send,
  Mic,
  MicOff,
  Image as ImageIcon,
  Globe,
  Camera,
  Paperclip,
  FileText,
  X,
  Loader2,
} from 'lucide-react'
import { useSessionStore } from '../../store/sessionStore'
import { useChatStore } from '../../store/chatStore'

function formatFileSize(bytes?: number): string {
  if (bytes == null) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

export function MessageInput() {
  const {
    inputValue,
    attachedFiles,
    isLoading,
    isListening,
    voiceLang,
    voiceContinuous,
    setInputValue,
    sendMessage,
    removeAttachedFile,
    setIsListening,
    setVoiceLang,
    setVoiceContinuous,
    handleDragOver,
    handleDrop,
    handlePaste,
    handleFileSelect,
    handleCameraSelect,
  } = useChatStore()

  const { currentSessionId } = useSessionStore()
  const recognitionRef = useRef<SpeechRecognition | null>(null)

  // SpeechRecognition setup
  useEffect(() => {
    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: typeof window.webkitSpeechRecognition }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: typeof window.webkitSpeechRecognition }).webkitSpeechRecognition
    if (!SpeechRecognition) return
    const rec = new SpeechRecognition()
    rec.lang = voiceLang
    rec.continuous = voiceContinuous
    rec.interimResults = voiceContinuous
    rec.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          transcript += event.results[i][0].transcript
        }
      }
      if (transcript) {
        setInputValue(inputValue + (inputValue ? ' ' : '') + transcript)
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
  }, [voiceLang, voiceContinuous, setInputValue, setIsListening, inputValue])

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
  }, [isListening, setIsListening])

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!currentSessionId) return
      handleDrop(e, currentSessionId)
    },
    [currentSessionId, handleDrop]
  )

  const onPaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      if (!currentSessionId) return
      handlePaste(e, currentSessionId)
    },
    [currentSessionId, handlePaste]
  )

  const onFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!currentSessionId) return
      handleFileSelect(e, currentSessionId)
    },
    [currentSessionId, handleFileSelect]
  )

  const onCameraSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!currentSessionId) return
      handleCameraSelect(e, currentSessionId)
    },
    [currentSessionId, handleCameraSelect]
  )

  return (
    <div className="sticky bottom-0 p-4 border-t border-border bg-card/80 backdrop-blur-md" onDragOver={handleDragOver} onDrop={onDrop}>
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
                onClick={() => removeAttachedFile(idx)}
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
            disabled={!currentSessionId || isLoading || !recognitionRef.current}
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
          className={`p-2.5 rounded-xl cursor-pointer transition ${!currentSessionId || isLoading ? 'opacity-50 cursor-not-allowed bg-secondary/70' : 'bg-secondary/70 hover:bg-secondary text-text-strong'}`}
          title="上传图片"
        >
          <ImageIcon className="w-4 h-4" />
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={onFileSelect}
            disabled={!currentSessionId || isLoading}
          />
        </label>
        <label
          className={`p-2.5 rounded-xl cursor-pointer transition ${!currentSessionId || isLoading ? 'opacity-50 cursor-not-allowed bg-secondary/70' : 'bg-secondary/70 hover:bg-secondary text-text-strong'}`}
          title="拍照"
        >
          <Camera className="w-4 h-4" />
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={onCameraSelect}
            disabled={!currentSessionId || isLoading}
          />
        </label>
        <label
          className={`p-2.5 rounded-xl cursor-pointer transition ${!currentSessionId || isLoading ? 'opacity-50 cursor-not-allowed bg-secondary/70' : 'bg-secondary/70 hover:bg-secondary text-text-strong'}`}
          title="上传文件"
        >
          <Paperclip className="w-4 h-4" />
          <input
            type="file"
            className="hidden"
            onChange={onFileSelect}
            disabled={!currentSessionId || isLoading}
          />
        </label>
        <input
          value={inputValue}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInputValue(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && sendMessage(inputValue)}
          onPaste={onPaste}
          disabled={!currentSessionId || isLoading}
          placeholder={currentSessionId ? '输入消息...' : '请先选择会话'}
          className="flex-1 bg-secondary/70 border border-white/10 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-accent/50 focus:bg-secondary transition disabled:opacity-50"
        />
        <button
          onClick={() => sendMessage(inputValue)}
          disabled={!currentSessionId || isLoading || (!inputValue.trim() && attachedFiles.length === 0)}
          className="px-5 py-2.5 bg-accent hover:bg-accent-hover disabled:bg-secondary rounded-xl text-white text-sm flex items-center gap-2 transition shadow-lg shadow-accent/20 hover:shadow-accent/30"
        >
          <Send className="w-4 h-4" />
          发送
        </button>
      </div>
    </div>
  )
}
