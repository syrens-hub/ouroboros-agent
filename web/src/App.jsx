import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bot,
  LayoutDashboard,
  Sparkles,
  Activity,
  RefreshCw,
  BookOpen,
  Image,
  GitBranch,
  Brain,
  TrendingUp,
} from 'lucide-react'
import { ChatView } from './components/ChatView'
import { SkillManager } from './components/SkillManager'
import { SystemDashboard } from './components/SystemDashboard'
import { KnowledgeBaseManager } from './components/KnowledgeBaseManager'
import { Gallery } from './components/Gallery'
import { WorkflowStudio } from './components/WorkflowStudio'
import { MemoryBrowser } from './components/MemoryBrowser'
import { TokenUsagePage } from './components/TokenUsagePage'
import { ToastContainer } from './components/ToastContainer'
import { apiFetch } from './api.js'

const PAGES = {
  CHAT: 'chat',
  SKILLS: 'skills',
  SYSTEM: 'system',
  KB: 'kb',
  GALLERY: 'gallery',
  WORKFLOW: 'workflow',
  MEMORY: 'memory',
  TOKEN_USAGE: 'token-usage',
}

function getStatusColor(status) {
  if (!status) return 'bg-danger'
  const healthy = status.daemonRunning && status.llmProvider !== 'local'
  const partial = status.daemonRunning || status.llmProvider !== 'local'
  if (healthy) return 'bg-ok'
  if (partial) return 'bg-warn'
  return 'bg-danger'
}

async function fetchSessions() {
  const res = await apiFetch('/api/sessions')
  const data = await res.json()
  return data.data || []
}

async function fetchSkills() {
  const res = await apiFetch('/api/skills')
  const data = await res.json()
  return data.data || []
}

async function fetchStatus() {
  const res = await apiFetch('/api/status')
  const data = await res.json()
  return data.data
}

function App() {
  const [currentPage, setCurrentPage] = useState(PAGES.CHAT)
  const queryClient = useQueryClient()

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: fetchSessions,
  })

  const { data: skills = [], isLoading: skillsLoading } = useQuery({
    queryKey: ['skills'],
    queryFn: fetchSkills,
  })

  const { data: systemStatus, isLoading: statusLoading } = useQuery({
    queryKey: ['status'],
    queryFn: fetchStatus,
    refetchInterval: 10000,
  })

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['sessions'] })
    queryClient.invalidateQueries({ queryKey: ['skills'] })
    queryClient.invalidateQueries({ queryKey: ['status'] })
  }

  const loading = sessionsLoading || skillsLoading || statusLoading

  return (
    <div className="min-h-screen p-6" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="gradient-border glass-strong flex items-center justify-between mb-6 px-5 py-4 rounded-xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center shadow-lg shadow-accent/20" style={{ background: 'var(--accent)' }}>
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold" style={{ color: 'var(--text-strong)' }}>Ouroboros Agent</h1>
                <span
                  className={`w-2 h-2 rounded-full ${getStatusColor(systemStatus)} shadow-[0_0_8px_currentColor]`}
                  title={systemStatus ? (systemStatus.daemonRunning && systemStatus.llmProvider !== 'local' ? '运行正常' : '部分可用') : '未连接'}
                />
              </div>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                {loading ? '加载中...' : `${sessions.length} 个会话 · ${skills.length} 个 Skills`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={refreshAll}
              disabled={loading}
              className="p-2 rounded-lg transition hover:bg-white/5"
              style={{ background: 'var(--secondary)' }}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} style={{ color: 'var(--text)' }} />
            </button>
          </div>
        </header>

        {/* Nav */}
        <nav className="flex flex-wrap items-center gap-1 mb-6 p-1 rounded-xl bg-white/[0.03] backdrop-blur-md border border-white/[0.06] w-fit">
          {[
            { key: PAGES.CHAT, label: '对话', icon: LayoutDashboard },
            { key: PAGES.SKILLS, label: 'Skills', icon: Sparkles },
            { key: PAGES.SYSTEM, label: '系统', icon: Activity },
            { key: PAGES.KB, label: '知识库', icon: BookOpen },
            { key: PAGES.GALLERY, label: '图库', icon: Image },
            { key: PAGES.WORKFLOW, label: '工作流', icon: GitBranch },
            { key: PAGES.MEMORY, label: '记忆', icon: Brain },
            { key: PAGES.TOKEN_USAGE, label: '用量', icon: TrendingUp },
          ].map(({ key, label, icon: Icon }) => {
            const active = currentPage === key
            return (
              <button
                key={key}
                onClick={() => setCurrentPage(key)}
                className={`relative px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-all duration-200 ${
                  active ? 'text-white' : 'text-text hover:text-white hover:bg-white/5'
                }`}
              >
                {active && (
                  <span className="absolute inset-0 rounded-lg bg-accent/90 shadow-md shadow-accent/20" />
                )}
                <span className="relative flex items-center gap-2">
                  <Icon className="w-4 h-4" />
                  {label}
                </span>
              </button>
            )
          })}
        </nav>

        {/* Page Content */}
        {currentPage === PAGES.KB ? (
          <KnowledgeBaseManager />
        ) : currentPage === PAGES.GALLERY ? (
          <Gallery />
        ) : currentPage === PAGES.WORKFLOW ? (
          <WorkflowStudio />
        ) : currentPage === PAGES.CHAT ? (
          <ChatView sessions={sessions} refreshSessions={() => queryClient.invalidateQueries({ queryKey: ['sessions'] })} systemStatus={systemStatus} />
        ) : currentPage === PAGES.SKILLS ? (
          <SkillManager skills={skills} />
        ) : currentPage === PAGES.MEMORY ? (
          <MemoryBrowser />
        ) : currentPage === PAGES.TOKEN_USAGE ? (
          <TokenUsagePage sessions={sessions} />
        ) : (
          <SystemDashboard status={systemStatus} />
        )}
      </div>

      <ToastContainer />
    </div>
  )
}

export default App
