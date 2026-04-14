import { useQuery } from '@tanstack/react-query'
import {
  BrainCircuit,
  Thermometer,
  Maximize2,
  Scissors,
  Coins,
} from 'lucide-react'
import { apiFetch } from '../api.js'

async function fetchPatterns() {
  const res = await apiFetch('/api/learning/patterns')
  return res.json()
}

async function fetchConfig(sessionId) {
  const res = await apiFetch(`/api/learning/config/${sessionId}`)
  return res.json()
}

export function LearningInsights({ sessionId = 'demo-session' }) {
  const { data: patternsData } = useQuery({
    queryKey: ['learning-patterns'],
    queryFn: fetchPatterns,
  })

  const { data: configData } = useQuery({
    queryKey: ['learning-config', sessionId],
    queryFn: () => fetchConfig(sessionId),
  })

  const rawPatterns = patternsData?.data?.patterns ?? patternsData?.data ?? []
  const patterns = Array.isArray(rawPatterns) ? rawPatterns.slice(0, 3) : []
  const config = configData?.data || {}

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h3 className="text-sm font-semibold text-text-strong mb-4 flex items-center gap-2">
        <BrainCircuit className="w-4 h-4 text-accent" />
        学习洞察
      </h3>

      <div className="space-y-4">
        <div>
          <div className="text-xs text-muted mb-2">Top Patterns</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {patterns.map((p, idx) => (
              <div key={idx} className="bg-secondary/30 border border-border rounded-lg p-3">
                <div className="text-xs text-muted mb-1">Sequence</div>
                <div className="text-sm text-text-strong font-medium truncate">{p.sequence}</div>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-muted">Success</span>
                  <span className="text-ok">{(p.successRate * 100).toFixed(0)}%</span>
                </div>
              </div>
            ))}
            {patterns.length === 0 && (
              <div className="col-span-full text-center text-xs text-muted py-4 bg-secondary/20 border border-border rounded-lg">
                暂无模式数据
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="text-xs text-muted mb-2">Config</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-secondary/30 border border-border rounded-lg p-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center">
                <Thermometer className="w-4 h-4 text-accent" />
              </div>
              <div>
                <div className="text-xs text-muted">Temperature</div>
                <div className="text-sm text-text-strong font-medium">{config.temperature ?? '-'}</div>
              </div>
            </div>
            <div className="bg-secondary/30 border border-border rounded-lg p-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center">
                <Maximize2 className="w-4 h-4 text-accent" />
              </div>
              <div>
                <div className="text-xs text-muted">Max Tokens</div>
                <div className="text-sm text-text-strong font-medium">{config.maxTokens ?? '-'}</div>
              </div>
            </div>
            <div className="bg-secondary/30 border border-border rounded-lg p-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center">
                <Scissors className="w-4 h-4 text-accent" />
              </div>
              <div>
                <div className="text-xs text-muted">Pruning</div>
                <div className="text-sm text-text-strong font-medium">{config.pruningStrategy ?? '-'}</div>
              </div>
            </div>
            <div className="bg-secondary/30 border border-border rounded-lg p-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center">
                <Coins className="w-4 h-4 text-accent" />
              </div>
              <div>
                <div className="text-xs text-muted">Context Budget</div>
                <div className="text-sm text-text-strong font-medium">{config.contextBudget ?? '-'}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
