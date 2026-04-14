import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  Square,
  Circle,
  Type,
  Loader2,
} from 'lucide-react'
import { apiFetch } from '../api.js'

async function fetchScreenshots() {
  const res = await apiFetch('/api/gallery/screenshots')
  return res.json()
}

async function drawCanvas(body) {
  const res = await apiFetch('/api/canvas/draw', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return res.json()
}

export function Gallery() {
  const [tab, setTab] = useState('screenshots')
  const [width, setWidth] = useState(400)
  const [height, setHeight] = useState(300)
  const [bgColor, setBgColor] = useState('#ffffff')
  const [commands, setCommands] = useState([])

  const { data: screenshotsData } = useQuery({
    queryKey: ['gallery-screenshots'],
    queryFn: fetchScreenshots,
    enabled: tab === 'screenshots',
  })

  const drawMutation = useMutation({
    mutationFn: drawCanvas,
  })

  const screenshots = screenshotsData?.data || []

  const addCommand = (type) => {
    const base = { type }
    if (type === 'rect') {
      base.x = 50
      base.y = 50
      base.width = 100
      base.height = 80
      base.fill = '#3b82f6'
    } else if (type === 'circle') {
      base.cx = 200
      base.cy = 150
      base.r = 40
      base.fill = '#ef4444'
    } else if (type === 'text') {
      base.x = 100
      base.y = 200
      base.text = 'Hello'
      base.fontSize = 16
      base.fill = '#111827'
    }
    const next = [...commands, base]
    setCommands(next)
    drawMutation.mutate({ width, height, backgroundColor: bgColor, commands: next })
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex gap-2 mb-5">
        <button
          onClick={() => setTab('screenshots')}
          className={`px-3 py-1.5 rounded-lg text-sm transition ${
            tab === 'screenshots'
              ? 'bg-accent text-white'
              : 'bg-secondary hover:bg-secondary/70 text-muted'
          }`}
        >
          截图
        </button>
        <button
          onClick={() => setTab('canvas')}
          className={`px-3 py-1.5 rounded-lg text-sm transition ${
            tab === 'canvas'
              ? 'bg-accent text-white'
              : 'bg-secondary hover:bg-secondary/70 text-muted'
          }`}
        >
          画布
        </button>
      </div>

      {tab === 'screenshots' && (
        <div>
          {screenshots.length === 0 && (
            <div className="text-sm text-muted text-center py-12">暂无截图</div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {screenshots.map((item, idx) => (
              <a
                key={idx}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="block bg-secondary/30 border border-border rounded-lg p-3 hover:border-accent/50 transition"
              >
                <div className="aspect-video bg-secondary rounded-md mb-2 flex items-center justify-center overflow-hidden">
                  <img src={item.url} alt={item.filename} className="w-full h-full object-cover" />
                </div>
                <div className="text-sm text-text-strong truncate">{item.filename}</div>
              </a>
            ))}
          </div>
        </div>
      )}

      {tab === 'canvas' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">宽</span>
              <input
                type="number"
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
                className="w-20 bg-secondary border border-border rounded-lg px-3 py-1.5 text-sm outline-none focus:border-accent"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">高</span>
              <input
                type="number"
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
                className="w-20 bg-secondary border border-border rounded-lg px-3 py-1.5 text-sm outline-none focus:border-accent"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">背景</span>
              <input
                type="color"
                value={bgColor}
                onChange={(e) => setBgColor(e.target.value)}
                className="w-10 h-8 rounded cursor-pointer border-0 bg-transparent"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => addCommand('rect')}
              className="px-3 py-1.5 bg-secondary hover:bg-secondary/70 rounded-lg text-sm flex items-center gap-1.5 transition"
            >
              <Square className="w-4 h-4" />
              矩形
            </button>
            <button
              onClick={() => addCommand('circle')}
              className="px-3 py-1.5 bg-secondary hover:bg-secondary/70 rounded-lg text-sm flex items-center gap-1.5 transition"
            >
              <Circle className="w-4 h-4" />
              圆形
            </button>
            <button
              onClick={() => addCommand('text')}
              className="px-3 py-1.5 bg-secondary hover:bg-secondary/70 rounded-lg text-sm flex items-center gap-1.5 transition"
            >
              <Type className="w-4 h-4" />
              文字
            </button>
          </div>

          <div className="bg-secondary/30 border border-border rounded-lg p-3">
            <div className="text-xs text-muted mb-1">JSON Preview</div>
            <pre className="text-xs text-text-strong overflow-x-auto">{JSON.stringify(commands, null, 2)}</pre>
          </div>

          {drawMutation.isPending && (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="w-4 h-4 animate-spin" />
              绘制中...
            </div>
          )}

          {drawMutation.isSuccess && drawMutation.data?.success && drawMutation.data?.data?.dataUrl && (
            <div className="border border-border rounded-lg p-3 bg-secondary/20">
              <img
                src={drawMutation.data.data.dataUrl}
                alt="canvas"
                className="max-w-full rounded-md"
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
