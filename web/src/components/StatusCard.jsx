import { Activity } from 'lucide-react'

export function StatusCard({ title, value, icon: Icon = Activity, status = 'normal', progress }) {
  const statusColors = {
    normal: 'text-text',
    warning: 'text-warn',
    error: 'text-danger',
    success: 'text-ok',
  }

  const progressGradient =
    status === 'error'
      ? 'from-danger to-danger/70'
      : status === 'warning'
        ? 'from-warn to-warn/70'
        : 'from-accent to-accent/70'

  return (
    <div className="relative overflow-hidden bg-card border border-white/10 rounded-xl p-4 flex items-center justify-between">
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.03] to-transparent pointer-events-none" />
      <div className="relative z-10">
        <p className="text-xs text-muted mb-1">{title}</p>
        <p className={`text-xl font-semibold ${statusColors[status] || 'text-text'}`}>{value}</p>
        {typeof progress === 'number' && (
          <div className="mt-3 w-32">
            <div className="h-1.5 w-full bg-secondary/60 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${progressGradient} transition-all duration-500`}
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
          </div>
        )}
      </div>
      <div className="relative z-10 w-10 h-10 rounded-lg bg-secondary/70 flex items-center justify-center border border-white/5 shadow-sm">
        <Icon className="w-5 h-5 text-accent" />
      </div>
    </div>
  )
}

export function ConnectionStatus({ connected, label }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`w-2 h-2 rounded-full ${connected ? 'bg-ok animate-pulse-subtle' : 'bg-danger'}`} />
      <span className={connected ? 'text-ok' : 'text-danger'}>{label}</span>
    </div>
  )
}
