import { useState } from 'react'
import { Monitor, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import type { ComputerUseData } from '../../types/chat'

interface ComputerUseCardProps {
  data: ComputerUseData
  onImageClick?: (url: string) => void
}

export function ComputerUseCard({ data, onImageClick }: ComputerUseCardProps) {
  const [open, setOpen] = useState(true)
  const isRunning = data._running === true
  const steps = Array.isArray(data._steps) ? data._steps : []
  return (
    <div className="rounded-lg border border-white/10 bg-secondary/30 overflow-hidden min-w-[16rem]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-secondary/50 transition"
      >
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          <Monitor className="w-4 h-4 text-accent" />
          <span>Computer Use</span>
          {isRunning ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/20 text-accent">
              {data.stepsTaken ?? steps.length} 步
            </span>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted" /> : <ChevronDown className="w-4 h-4 text-muted" />}
      </button>
      {open && (
        <div className="px-3 pb-3 text-xs text-muted space-y-2">
          <div>
            <span className="text-white/70 font-medium">目标：</span>
            <span className="text-white">{data.goal}</span>
          </div>
          {!isRunning && data.summary && (
            <div>
              <span className="text-white/70 font-medium">结果：</span>
              <span className="text-white">{data.summary}</span>
            </div>
          )}
          {steps.length > 0 && (
            <div className="space-y-2">
              <span className="text-white/70 font-medium">执行记录：</span>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {steps.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 rounded border border-white/5 bg-black/20 p-2">
                    <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/20 text-[10px] text-accent font-bold">
                      {s.step}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-white/90 truncate">{s.message}</div>
                      {s.detail?.screenshotUrl && (
                        <img
                          src={s.detail.screenshotUrl}
                          alt={`step ${s.step}`}
                          className="mt-1 max-w-[8rem] rounded border border-white/10 cursor-zoom-in"
                          onClick={() => onImageClick && onImageClick(s.detail!.screenshotUrl!)}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!isRunning && data.finalScreenshotUrl && (
            <div>
              <span className="text-white/70 font-medium block mb-1">最终截图：</span>
              <img
                src={data.finalScreenshotUrl}
                alt="final screenshot"
                className="max-w-xs rounded-lg border border-white/10 cursor-zoom-in"
                onClick={() => onImageClick && onImageClick(data.finalScreenshotUrl!)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
