import { create } from 'zustand'
import { apiFetch } from '../api'
import type { Session } from '../types/chat'

interface SessionState {
  sessions: Session[]
  currentSessionId: string | null
  isCreating: boolean
  setSessions: (sessions: Session[]) => void
  fetchSessions: () => Promise<void>
  createSession: (name?: string) => Promise<string>
  switchSession: (id: string) => void
  deleteSession: (id: string) => Promise<void>
}

export const useSessionStore = create<SessionState>((set, _get) => ({
  sessions: [],
  currentSessionId: null,
  isCreating: false,

  setSessions: (sessions) => set({ sessions }),

  fetchSessions: async () => {
    const res = await apiFetch('/api/sessions')
    const data = (await res.json()) as { data?: Session[] }
    set({ sessions: data.data || [] })
  },

  createSession: async (name?: string) => {
    set({ isCreating: true })
    try {
      const res = await apiFetch('/api/sessions', { method: 'POST' })
      const data = (await res.json()) as { success?: boolean; data?: { sessionId: string } }
      if (data.success && data.data) {
        const newSession: Session = { sessionId: data.data.sessionId, title: name }
        set((state) => ({
          sessions: [newSession, ...state.sessions],
          currentSessionId: data.data!.sessionId,
        }))
        return data.data.sessionId
      }
      throw new Error('Failed to create session')
    } finally {
      set({ isCreating: false })
    }
  },

  switchSession: (id: string) => {
    set({ currentSessionId: id })
  },

  deleteSession: async (id: string) => {
    await apiFetch(`/api/sessions/${id}`, { method: 'DELETE' })
    set((state) => ({
      sessions: state.sessions.filter((s) => s.sessionId !== id),
      currentSessionId: state.currentSessionId === id ? null : state.currentSessionId,
    }))
  },
}))
