import { EvolutionPipelineCard } from '../EvolutionPipelineCard'
import { EvolutionControlPanel } from '../EvolutionControlPanel'
import { LearningInsights } from '../LearningInsights'

export function EvolutionHistory() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <EvolutionPipelineCard />
        <EvolutionControlPanel />
      </div>
      <div className="bg-card border border-border rounded-xl p-5">
        <LearningInsights sessionId="system" />
      </div>
    </div>
  )
}
