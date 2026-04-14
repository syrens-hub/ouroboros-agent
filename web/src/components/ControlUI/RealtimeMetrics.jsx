export function RealtimeMetrics({ metrics }) {
  const latencyMetric = metrics?.find((m) => m.type === 'latency' || m.label.toLowerCase().includes('latency'))
  const numberMetrics = metrics?.filter((m) => m.type === 'number') || []
  const barMetrics = metrics?.filter((m) => {
    if (m.type === 'latency' || m.label.toLowerCase().includes('latency')) return false
    if (m.type === 'number') return false
    return true
  }) || []

  const latencyNorm = latencyMetric ? Math.min(1, latencyMetric.value / 5000) : 0
  const sparklinePoints = latencyMetric
    ? `0,30 20,${30 - latencyNorm * 20} 40,${30 - latencyNorm * 15} 60,${30 - latencyNorm * 25} 80,${30 - latencyNorm * 10} 100,${30 - latencyNorm * 30}`
    : '0,30 20,25 40,28 60,20 80,22 100,15'

  return (
    <div className="space-y-4">
      {numberMetrics.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {numberMetrics.map(({ label, value, suffix }, idx) => (
            <div key={idx} className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-2">
              <div className="text-[10px] text-muted">{label}</div>
              <div className="text-sm font-mono text-white">
                {value}
                {suffix ? <span className="text-[10px] text-muted ml-0.5">{suffix}</span> : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {barMetrics.map(({ label, value }, idx) => {
        const pct = Math.max(0, Math.min(1, value)) * 100
        return (
          <div key={idx}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted">{label}</span>
              <span className="text-white font-mono">{(pct).toFixed(0)}%</span>
            </div>
            <div className="w-full h-2 bg-secondary/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )
      })}

      {latencyMetric && (
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted">{latencyMetric.label}</span>
            <span className="text-white font-mono">{latencyMetric.value}ms</span>
          </div>
          <svg
            viewBox="0 0 100 40"
            className="w-full h-10"
            preserveAspectRatio="none"
          >
            <polyline
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-accent"
              points={sparklinePoints}
            />
          </svg>
        </div>
      )}
    </div>
  )
}
