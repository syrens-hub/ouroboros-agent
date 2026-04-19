export interface Session {
  sessionId: string
  title?: string
}

export interface SystemStatus {
  llmProvider?: string
  llmModel?: string
  daemonRunning?: boolean
  skillCount?: number
}

export interface ContentBlock {
  type: string
  text?: string
  image_url?: { url: string }
  name?: string
}

export interface Message {
  role: string
  content: string | ContentBlock[]
  timestamp?: number
  id?: string | number
  messageId?: string | number
  _streaming?: boolean
  name?: string
}

export interface Tool {
  id: string
  name: string
  input?: unknown
  result?: string | null
  isError?: boolean
}

export interface ConfirmModalState {
  toolName: string
  input?: unknown
  timeoutMs?: number
}

export interface ReviewNotice {
  id: number
  title?: string
  message?: string
  meta?: { action?: string; sessionId?: string }
  type?: string
}

export interface ComputerUseStep {
  step: number | string
  message: string
  detail?: { screenshotUrl?: string }
}

export interface ComputerUseData {
  _running?: boolean
  _steps?: ComputerUseStep[]
  goal?: string
  summary?: string
  stepsTaken?: number
  finalScreenshotUrl?: string
  history?: unknown[]
  success?: boolean
  toolUseId?: string
}

export interface TraceEvent {
  turn: number
  type: string
  actor: string
  timestamp?: number
  latencyMs?: number
  tokens?: number
  input?: unknown
  output?: unknown
}

export interface AttachedFile {
  id: string
  previewUrl?: string
  name: string
  type: 'image' | 'file'
  size?: number
  uploading: boolean
  serverUrl?: string
}
