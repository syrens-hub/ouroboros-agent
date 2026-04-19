import { create } from 'zustand'

export interface SystemMetrics {
  cpu: number
  memory: number
  disk: number
}

export interface HealthCheck {
  name: string
  status: 'pass' | 'warn' | 'fail'
  msg?: string
}

export interface ControlStatusState {
  selfHealing: boolean
  scheduler: boolean
  knowledgeBase: boolean
  browser: boolean
  canvas: boolean
  daemon: boolean
}

export interface AlertItem {
  type: string
  message: string
  timestamp: number
}

interface DashboardState {
  systemMetrics: SystemMetrics
  healthChecks: HealthCheck[]
  checking: boolean
  controlStatus: ControlStatusState
  alerts: AlertItem[]

  setSystemMetrics: (metrics: SystemMetrics | ((prev: SystemMetrics) => SystemMetrics)) => void
  setHealthChecks: (checks: HealthCheck[]) => void
  setChecking: (checking: boolean) => void
  setControlStatus: (status: ControlStatusState | ((prev: ControlStatusState) => ControlStatusState)) => void
  setAlerts: (alerts: AlertItem[]) => void
}

export const useDashboardStore = create<DashboardState>((set) => ({
  systemMetrics: { cpu: 12, memory: 34, disk: 28 },
  healthChecks: [],
  checking: false,
  controlStatus: {
    selfHealing: true,
    scheduler: true,
    knowledgeBase: true,
    browser: false,
    canvas: false,
    daemon: false,
  },
  alerts: [
    { type: 'security', message: 'Permission denied: write_file by session test', timestamp: Date.now() - 60000 },
    { type: 'webhook', message: 'Webhook delivered: gh-push', timestamp: Date.now() - 120000 },
  ],

  setSystemMetrics: (metrics) =>
    set((state) => ({
      systemMetrics: typeof metrics === 'function' ? metrics(state.systemMetrics) : metrics,
    })),
  setHealthChecks: (healthChecks) => set({ healthChecks }),
  setChecking: (checking) => set({ checking }),
  setControlStatus: (status) =>
    set((state) => ({
      controlStatus: typeof status === 'function' ? status(state.controlStatus) : status,
    })),
  setAlerts: (alerts) => set({ alerts }),
}))
