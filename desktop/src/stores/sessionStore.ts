import { create } from 'zustand'
import { sessionsApi } from '../api/sessions'
import { useSessionRuntimeStore } from './sessionRuntimeStore'
import type { SessionListItem } from '../types/session'

const PINNED_STORAGE_KEY = 'ambi-pinned-sessions'

function loadPinnedIds(): string[] {
  try {
    const stored = localStorage.getItem(PINNED_STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed)) return parsed.filter((id): id is string => typeof id === 'string')
    }
  } catch { /* localStorage unavailable or malformed */ }
  return []
}

function savePinnedIds(ids: string[]): void {
  try {
    localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(ids))
  } catch { /* localStorage unavailable */ }
}

type SessionStore = {
  sessions: SessionListItem[]
  activeSessionId: string | null
  isLoading: boolean
  error: string | null
  selectedProjects: string[]
  availableProjects: string[]
  pinnedSessionIds: string[]

  fetchSessions: (project?: string) => Promise<void>
  createSession: (workDir?: string) => Promise<string>
  deleteSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  updateSessionTitle: (id: string, title: string) => void
  setActiveSession: (id: string | null) => void
  setSelectedProjects: (projects: string[]) => void
  pinSession: (id: string) => void
  unpinSession: (id: string) => void
  isSessionPinned: (id: string) => boolean
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  isLoading: false,
  error: null,
  selectedProjects: [],
  availableProjects: [],
  pinnedSessionIds: loadPinnedIds(),

  fetchSessions: async (project?: string) => {
    set({ isLoading: true, error: null })
    try {
      const { sessions: raw } = await sessionsApi.list({ project, limit: 100 })
      // Deduplicate by session ID — keep the most recently modified entry
      const byId = new Map<string, SessionListItem>()
      for (const s of raw) {
        const existing = byId.get(s.id)
        if (!existing || new Date(s.modifiedAt) > new Date(existing.modifiedAt)) {
          byId.set(s.id, s)
        }
      }
      const sessions = [...byId.values()]
      const availableProjects = [...new Set(sessions.map((s) => s.projectPath).filter(Boolean))].sort()
      set({ sessions, availableProjects, isLoading: false })
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false })
    }
  },

  createSession: async (workDir?: string) => {
    const { sessionId: id } = await sessionsApi.create(workDir || undefined)
    const now = new Date().toISOString()
    const optimisticSession: SessionListItem = {
      id,
      title: 'New Session',
      createdAt: now,
      modifiedAt: now,
      messageCount: 0,
      projectPath: '',
      workDir: workDir ?? null,
      workDirExists: true,
    }

    set((state) => ({
      sessions: state.sessions.some((session) => session.id === id)
        ? state.sessions
        : [optimisticSession, ...state.sessions],
      activeSessionId: id,
    }))

    void get().fetchSessions()
    return id
  },

  deleteSession: async (id: string) => {
    await sessionsApi.delete(id)
    useSessionRuntimeStore.getState().clearSelection(id)
    set((s) => {
      const newPinned = s.pinnedSessionIds.filter((pid) => pid !== id)
      if (newPinned.length !== s.pinnedSessionIds.length) {
        savePinnedIds(newPinned)
      }
      return {
        sessions: s.sessions.filter((session) => session.id !== id),
        activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
        pinnedSessionIds: newPinned,
      }
    })
  },

  renameSession: async (id: string, title: string) => {
    await sessionsApi.rename(id, title)
    set((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === id ? { ...session, title } : session,
      ),
    }))
  },

  updateSessionTitle: (id, title) => {
    set((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === id ? { ...session, title } : session,
      ),
    }))
  },

  setActiveSession: (id) => set({ activeSessionId: id }),
  setSelectedProjects: (projects) => set({ selectedProjects: projects }),

  pinSession: (id) => {
    set((s) => {
      if (s.pinnedSessionIds.includes(id)) return s
      const newPinned = [id, ...s.pinnedSessionIds]
      savePinnedIds(newPinned)
      return { pinnedSessionIds: newPinned }
    })
  },

  unpinSession: (id) => {
    set((s) => {
      const newPinned = s.pinnedSessionIds.filter((pid) => pid !== id)
      savePinnedIds(newPinned)
      return { pinnedSessionIds: newPinned }
    })
  },

  isSessionPinned: (id) => get().pinnedSessionIds.includes(id),
}))
