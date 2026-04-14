import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TrendingUp, Calendar } from 'lucide-react'
import { apiFetch } from '../api.js'

async function fetchTokenUsage(sessionId, granularity, days) {
  const qs = new URLSearchParams()
  if (sessionId) qs.set('sessionId', sessionId)
  qs.set('granularity', granularity)
  qs.set('days', String(days))
  const res = await apiFetch(`/api/token-usage?${qs.toString()}`)
  const json = await res.json()
  return json.data || []
}

function formatNumber(n) {
  return n.toLocaleString()
}

function SimpleAreaChart({ data, height = 160 }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-xs" style={{ color: 'var(--muted)' }}>
        暂无数据
      </div>
    )
  }
  const values = data.map((d) => d.tokens)
  const max = Math.max(1, ...values)
  const width = 100
  const step = width / Math.max(1, values.length - 1)
  const points = values.map((v, i) => [i * step, height - (v / max) * height])
  const areaPath = `M${points[0][0]},${height} ` + points.map((p) => `L${p[0]},${p[1]}`).join(' ') + ` L${points[points.length - 1][0]},${height} Z`
  const linePath = `M` + points.map((p) => `${p[0]},${p[1]}`).join(' L')

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(99,102,241,0.35)" />
          <stop offset="100%" stopColor="rgba(99,102,241,0.02)" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#areaGradient)" />
      <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="2" />
      {points.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="1.5" fill="var(--accent)" />
      ))}
    </svg>
  )
}

export function TokenUsagePage({ sessions = [] }) {
  const [sessionId, setSessionId] = useState('')
  const [granularity, setGranularity] = useState('hour')
  const [days, setDays] = useState(7)

  const { data = [], isLoading } = useQuery({
    queryKey: ['token-usage', sessionId || 'all', granularity, days],
    queryFn: () => fetchTokenUsage(sessionId || undefined, granularity, days),
    refetchInterval: 10_000,
  })

  const totalTokens = useMemo(() => data.reduce((s, d) => s + d.tokens, 0), [data])
  const avgTokens = useMemo(() => (data.length > 0 ? Math.round(totalTokens / data.length) : 0), [data, totalTokens])
  const peak = useMemo(() => (data.length > 0 ? Math.max(...data.map((d) => d.tokens)) : 0), [data])

  return (
    <div className="space-y-5">
      <div className="glass-strong rounded-xl p-4 border border-white/[0.06]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent)' }}>
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-strong)' }}>Token 用量分析</h2>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>按会话或全局维度查看 Token 消耗趋势</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              className="px-3 py-2 rounded-lg text-sm bg-white/[0.04] border border-white/[0.08] focus:outline-none focus:border-accent/50"
              style={{ color: 'var(--text)' }}
            >
              <option value="">全部会话</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>{s.title || s.id}</option>
              ))}
            </select>
            <select
              value={granularity}
              onChange={(e) => setGranularity(e.target.value)}
              className="px-3 py-2 rounded-lg text-sm bg-white/[0.04] border border-white/[0.08] focus:outline-none focus:border-accent/50"
              style={{ color: 'var(--text)' }}
            >
              <option value="hour">按小时</option>
              <option value="day">按天</option>
            </select>
            <select
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value, 10))}
              className="px-3 py-2 rounded-lg text-sm bg-white/[0.04] border border-white/[0.08] focus:outline-none focus:border-accent/50"
              style={{ color: 'var(--text)' }}
            >
              <option value={1}>近 1 天</option>
              <option value={7}>近 7 天</option>
              <option value={30}>近 30 天</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass rounded-xl p-4 border border-white/[0.06]">
          <div className="text-xs mb-1" style={{ color: 'var(--muted)' }}>总 Token 数</div>
          <div className="text-2xl font-semibold" style={{ color: 'var(--text-strong)' }}>{formatNumber(totalTokens)}</div>
        </div>
        <div className="glass rounded-xl p-4 border border-white/[0.06]">
          <div className="text-xs mb-1" style={{ color: 'var(--muted)' }}>平均 {granularity === 'hour' ? '每小时' : '每天'}</div>
          <div className="text-2xl font-semibold" style={{ color: 'var(--text-strong)' }}>{formatNumber(avgTokens)}</div>
        </div>
        <div className="glass rounded-xl p-4 border border-white/[0.06]">
          <div className="text-xs mb-1" style={{ color: 'var(--muted)' }}>峰值</div>
          <div className="text-2xl font-semibold" style={{ color: 'var(--text-strong)' }}>{formatNumber(peak)}</div>
        </div>
      </div>

      <div className="glass rounded-xl p-4 border border-white/[0.06]">
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="w-4 h-4 text-accent" />
          <span className="text-sm font-medium" style={{ color: 'var(--text-strong)' }}>趋势图</span>
        </div>
        <div className="h-40 w-full">
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-xs" style={{ color: 'var(--muted)' }}>加载中…</div>
          ) : (
            <SimpleAreaChart data={data} />
          )}
        </div>
      </div>

      <div className="glass rounded-xl p-4 border border-white/[0.06] overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.08]">
              <th className="text-left py-2 font-medium" style={{ color: 'var(--muted)' }}>时间</th>
              <th className="text-right py-2 font-medium" style={{ color: 'var(--muted)' }}>Token 数</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && !isLoading && (
              <tr>
                <td colSpan={2} className="py-6 text-center" style={{ color: 'var(--muted)' }}>暂无数据</td>
              </tr>
            )}
            {data.map((row, idx) => (
              <tr key={idx} className="border-b border-white/[0.04] last:border-0">
                <td className="py-2" style={{ color: 'var(--text)' }}>{row.time}</td>
                <td className="py-2 text-right font-mono" style={{ color: 'var(--text-strong)' }}>{formatNumber(row.tokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
