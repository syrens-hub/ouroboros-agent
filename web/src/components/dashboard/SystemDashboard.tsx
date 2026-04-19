import { useEffect } from 'react'
import { useDashboardStore } from '../../store/dashboardStore'
import { SystemOverview } from './SystemOverview'
import { MetricsPanel } from './MetricsPanel'
import { ConfigPanel } from './ConfigPanel'
import { LogViewer } from './LogViewer'
import { TaskSchedulerPanel } from './TaskSchedulerPanel'
import { EvolutionHistory } from './EvolutionHistory'
import type { SystemStatus } from './types'

export function SystemDashboard({ status }: { status?: SystemStatus }) {
  const setControlStatus = useDashboardStore((s) => s.setControlStatus)

  useEffect(() => {
    setControlStatus((prev) => ({ ...prev, daemon: status?.daemonRunning || false }))
  }, [status?.daemonRunning, setControlStatus])

  return (
    <div className="space-y-6">
      <SystemOverview status={status} />
      <EvolutionHistory />
      <MetricsPanel />
      <ConfigPanel status={status} />
      <LogViewer status={status} />
      <TaskSchedulerPanel />
    </div>
  )
}
