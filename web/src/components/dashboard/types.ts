export interface SystemStatus {
  sessionCount?: number
  llmProvider?: string
  llmModel?: string
  daemonRunning?: boolean
  memoryRecalls24h?: number
  skillCount?: number
  imPlugins?: string[]
  deepDreamingLastRun?: string | number
}

export interface HealthCheck {
  name: string
  status: 'pass' | 'warn' | 'fail'
  msg?: string
}

export interface MetricsData {
  runnerPool?: { size?: number; max?: number }
  memoryUsageMB?: number
  wsClients?: number
  wsConnectionsTotal?: number
  tasksPending?: number
  tasksRunning?: number
  uptimeSeconds?: number
  llmLatencyMs?: number
  llmP95LatencyMs?: number
  llmCalls?: number
  tokenUsage24h?: number
  tokenAlertThreshold?: number
}

export interface CircuitBreaker {
  provider: string
  state: string
  failureCount: number
  nextRetryTime?: string | number
}

export interface Budget {
  totalBudget: number
  usedEstimate: number
  remainingPercent: number
  status: string
  llmCalls24h: number
  tokenUsage24h: number
}

export interface AlertItem {
  type: string
  message: string
  timestamp: number
}

export interface RealtimeMetric {
  type?: string
  label: string
  value: number
  suffix?: string
}

export interface ImStatus {
  feishu?: { available?: boolean; running?: boolean; webhookUrl?: string }
  mockChat?: { available?: boolean }
}

export interface SelfHealing {
  active?: boolean
  snapshots?: number
}

export interface DaemonHistoryItem {
  action: string
  applied: boolean
  sessionId: string
  skillName?: string
  reason: string
}

export interface DbBackup {
  filename: string
  createdAt: string | number
  sizeBytes: number
}

export interface TaskItem {
  id: string
  name?: string
  status: string
  runCount: number
}

export interface QueueStats {
  pending: number
  failed: number
  delayed: number
}

export interface ControlStatusState {
  selfHealing: boolean
  scheduler: boolean
  knowledgeBase: boolean
  browser: boolean
  canvas: boolean
  daemon: boolean
}
