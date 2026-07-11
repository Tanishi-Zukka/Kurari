import { create } from 'zustand'

export interface HistoryEntry {
  undo: () => void | Promise<void>
  redo: () => void | Promise<void>
}

interface HistoryState {
  past: HistoryEntry[]
  future: HistoryEntry[]
  push: (entry: HistoryEntry) => void
  undo: () => Promise<void>
  redo: () => Promise<void>
  clear: () => void
}

const MAX_HISTORY = 100

/**
 * ボード操作の undo/redo スタック。各エントリは自分自身で undo/redo の
 * ロジック（entity-store の呼び出し）を持つ。canUndo/canRedo は
 * past.length / future.length をコンポーネント側で selector すれば十分なため、
 * 専用フィールドは持たない。
 */
export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],

  push: (entry) =>
    set((s) => ({
      past: [...s.past, entry].slice(-MAX_HISTORY),
      future: [],
    })),

  undo: async () => {
    const { past } = get()
    if (past.length === 0) return
    const entry = past[past.length - 1]
    set({ past: past.slice(0, -1) })
    await entry.undo()
    set((s) => ({ future: [...s.future, entry] }))
  },

  redo: async () => {
    const { future } = get()
    if (future.length === 0) return
    const entry = future[future.length - 1]
    set({ future: future.slice(0, -1) })
    await entry.redo()
    set((s) => ({ past: [...s.past, entry] }))
  },

  clear: () => set({ past: [], future: [] }),
}))
