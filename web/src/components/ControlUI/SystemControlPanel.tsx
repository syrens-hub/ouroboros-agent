import {
  HeartPulse,
  Clock,
  Database,
  Globe,
  LayoutTemplate,
  Server,
  type LucideIcon,
} from 'lucide-react'

interface CardConfig {
  key: string
  title: string
  icon: LucideIcon
}

const CARDS: CardConfig[] = [
  { key: 'selfHealing', title: 'Self-Healing', icon: HeartPulse },
  { key: 'scheduler', title: 'Task Scheduler', icon: Clock },
  { key: 'knowledgeBase', title: 'Knowledge Base', icon: Database },
  { key: 'browser', title: 'Browser', icon: Globe },
  { key: 'canvas', title: 'Canvas', icon: LayoutTemplate },
  { key: 'daemon', title: 'Daemon', icon: Server },
]

interface SystemControlPanelProps {
  status?: Record<string, boolean>
  onToggle: (key: string, enabled: boolean) => void
}

export function SystemControlPanel({ status, onToggle }: SystemControlPanelProps) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {CARDS.map(({ key, title, icon: Icon }) => {
        const enabled = !!status?.[key]
        return (
          <div
            key={key}
            className={`rounded-lg border p-3 flex items-center justify-between transition ${
              enabled
                ? 'bg-ok/10 border-ok/30'
                : 'bg-secondary/30 border-border/50'
            }`}
          >
            <div className="flex items-center gap-2">
              <Icon
                className={`w-4 h-4 ${
                  enabled ? 'text-ok' : 'text-muted'
                }`}
              />
              <span
                className={`text-sm font-medium ${
                  enabled ? 'text-white' : 'text-muted'
                }`}
              >
                {title}
              </span>
            </div>
            <button
              type="button"
              aria-pressed={enabled}
              onClick={() => onToggle(key, !enabled)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
                enabled ? 'bg-ok' : 'bg-muted/40'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${
                  enabled ? 'translate-x-4.5' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        )
      })}
    </div>
  )
}
