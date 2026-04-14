import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  Play,
  Loader2,
  CheckCircle,
  XCircle,
} from 'lucide-react'
import { apiFetch } from '../api.js'

async function runCrew(body) {
  const res = await apiFetch('/api/crew/run', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return res.json()
}

async function fetchSopTemplates() {
  const res = await apiFetch('/api/sop/templates')
  return res.json()
}

async function runSop(body) {
  const res = await apiFetch('/api/sop/run', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return res.json()
}

export function WorkflowStudio() {
  const [tab, setTab] = useState('crewai')

  // CrewAI state
  const [task, setTask] = useState('')
  const [roles, setRoles] = useState('[]')
  const [process, setProcess] = useState('sequential')
  const crewMutation = useMutation({ mutationFn: runCrew })

  // SOP state
  const [sopMode, setSopMode] = useState('template')
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [customSop, setCustomSop] = useState('')
  const sopMutation = useMutation({ mutationFn: runSop })

  const { data: templatesData } = useQuery({
    queryKey: ['sop-templates'],
    queryFn: fetchSopTemplates,
    enabled: tab === 'sop',
  })

  const templates = Array.isArray(templatesData?.data) ? templatesData.data : []
  const activeTemplate = templates.find((t) => t.id === selectedTemplate)

  const handleRunCrew = () => {
    let parsedRoles
    try {
      parsedRoles = JSON.parse(roles)
    } catch {
      parsedRoles = []
    }
    crewMutation.mutate({ task, roles: parsedRoles, process })
  }

  const handleRunSop = () => {
    const definition = sopMode === 'template' && activeTemplate
      ? activeTemplate
      : (() => {
          try { return JSON.parse(customSop) } catch { return undefined }
        })()
    sopMutation.mutate({ definition, initialState: {} })
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex gap-2 mb-5">
        <button
          onClick={() => setTab('crewai')}
          className={`px-3 py-1.5 rounded-lg text-sm transition ${
            tab === 'crewai'
              ? 'bg-accent text-white'
              : 'bg-secondary hover:bg-secondary/70 text-muted'
          }`}
        >
          CrewAI
        </button>
        <button
          onClick={() => setTab('sop')}
          className={`px-3 py-1.5 rounded-lg text-sm transition ${
            tab === 'sop'
              ? 'bg-accent text-white'
              : 'bg-secondary hover:bg-secondary/70 text-muted'
          }`}
        >
          SOP
        </button>
      </div>

      {tab === 'crewai' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-muted mb-1">Task</label>
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              rows={4}
              placeholder="输入任务描述..."
              className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-sm outline-none focus:border-accent resize-none"
            />
          </div>
          <div>
            <label className="block text-sm text-muted mb-1">Roles (JSON array)</label>
            <textarea
              value={roles}
              onChange={(e) => setRoles(e.target.value)}
              rows={4}
              placeholder='例如: [{"name":"Researcher","goal":"Find info"}]'
              className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-sm outline-none focus:border-accent resize-none"
            />
          </div>
          <div>
            <label className="block text-sm text-muted mb-1">Process</label>
            <select
              value={process}
              onChange={(e) => setProcess(e.target.value)}
              className="bg-secondary border border-border rounded-lg px-4 py-2 text-sm outline-none focus:border-accent"
            >
              <option value="sequential">sequential</option>
              <option value="hierarchical">hierarchical</option>
              <option value="parallel">parallel</option>
            </select>
          </div>
          <button
            onClick={handleRunCrew}
            disabled={crewMutation.isPending || !task.trim()}
            className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:bg-secondary rounded-lg text-white text-sm flex items-center gap-2 transition"
          >
            {crewMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Run
          </button>

          {crewMutation.isSuccess && (
            <div className={`mt-2 text-sm flex items-start gap-2 ${crewMutation.data?.success ? 'text-ok' : 'text-danger'}`}>
              {crewMutation.data?.success ? <CheckCircle className="w-4 h-4 mt-0.5" /> : <XCircle className="w-4 h-4 mt-0.5" />}
              <div className="flex-1">
                {crewMutation.data?.success ? (
                  <div className="space-y-2">
                    {crewMutation.data.data?.results && (
                      <pre className="bg-secondary/50 border border-border rounded-lg p-3 text-xs overflow-x-auto">
                        {JSON.stringify(crewMutation.data.data.results, null, 2)}
                      </pre>
                    )}
                    {crewMutation.data.data?.finalOutput !== undefined && (
                      <div className="text-text-strong">{String(crewMutation.data.data.finalOutput)}</div>
                    )}
                  </div>
                ) : (
                  crewMutation.data?.error?.message || '运行失败'
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'sop' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSopMode('template')}
              className={`px-3 py-1.5 rounded-lg text-sm transition ${
                sopMode === 'template'
                  ? 'bg-accent text-white'
                  : 'bg-secondary hover:bg-secondary/70 text-muted'
              }`}
            >
              模板
            </button>
            <button
              onClick={() => setSopMode('custom')}
              className={`px-3 py-1.5 rounded-lg text-sm transition ${
                sopMode === 'custom'
                  ? 'bg-accent text-white'
                  : 'bg-secondary hover:bg-secondary/70 text-muted'
              }`}
            >
              Custom
            </button>
          </div>

          {sopMode === 'template' && (
            <div>
              <label className="block text-sm text-muted mb-1">选择模板</label>
              <select
                value={selectedTemplate}
                onChange={(e) => setSelectedTemplate(e.target.value)}
                className="w-full bg-secondary border border-border rounded-lg px-4 py-2 text-sm outline-none focus:border-accent"
              >
                <option value="">-- 请选择 --</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {activeTemplate && (
                <pre className="mt-3 bg-secondary/30 border border-border rounded-lg p-3 text-xs text-text-strong overflow-x-auto">
                  {JSON.stringify(activeTemplate, null, 2)}
                </pre>
              )}
            </div>
          )}

          {sopMode === 'custom' && (
            <div>
              <label className="block text-sm text-muted mb-1">SOP JSON</label>
              <textarea
                value={customSop}
                onChange={(e) => setCustomSop(e.target.value)}
                rows={8}
                placeholder="输入自定义 SOP JSON..."
                className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-sm outline-none focus:border-accent resize-none"
              />
            </div>
          )}

          <button
            onClick={handleRunSop}
            disabled={sopMutation.isPending || (sopMode === 'template' ? !activeTemplate : !customSop.trim())}
            className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:bg-secondary rounded-lg text-white text-sm flex items-center gap-2 transition"
          >
            {sopMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Run
          </button>

          {sopMutation.isSuccess && (
            <div className={`mt-2 text-sm flex items-start gap-2 ${sopMutation.data?.success ? 'text-ok' : 'text-danger'}`}>
              {sopMutation.data?.success ? <CheckCircle className="w-4 h-4 mt-0.5" /> : <XCircle className="w-4 h-4 mt-0.5" />}
              <div className="flex-1">
                {sopMutation.data?.success ? (
                  <pre className="bg-secondary/50 border border-border rounded-lg p-3 text-xs overflow-x-auto">
                    {JSON.stringify(sopMutation.data.outputs ?? sopMutation.data.data?.outputs, null, 2)}
                  </pre>
                ) : (
                  sopMutation.data?.error?.message || '运行失败'
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
