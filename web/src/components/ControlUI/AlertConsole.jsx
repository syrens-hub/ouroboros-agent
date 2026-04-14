export function AlertConsole({ alerts }) {
  return (
    <div className="max-h-48 overflow-y-auto space-y-2">
      {alerts.length === 0 && (
        <div className="text-sm text-muted">暂无告警</div>
      )}
      {alerts.map((alert, idx) => {
        const isSecurity = alert.type === 'security'
        const timeString =
          typeof alert.timestamp === 'number'
            ? new Date(alert.timestamp).toLocaleTimeString('zh-CN')
            : alert.timestamp
        return (
          <div
            key={idx}
            className={`rounded-lg border p-3 text-xs ${
              isSecurity
                ? 'bg-danger/10 border-danger/30'
                : 'bg-info/10 border-info/30'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span
                className={`font-medium ${
                  isSecurity ? 'text-danger' : 'text-info'
                }`}
              >
                {isSecurity ? 'Security' : 'Webhook'}
              </span>
              <span className="text-muted">{timeString}</span>
            </div>
            <div className="text-white/90">{alert.message}</div>
          </div>
        )
      })}
    </div>
  )
}
