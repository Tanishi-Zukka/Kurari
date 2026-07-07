import { create } from 'zustand'
import type { AiStatus } from '@/types/model'
import type { WsState } from '@/lib/ws'

export type PanelTab = 'comments' | 'ai' | 'chat' | 'activity' | 'decisions'

interface UiState {
  activeBoardId: string | null
  activeDocId: string | null
  selectedIds: string[]
  panelTab: PanelTab
  sidebarOpen: boolean
  panelOpen: boolean
  wsState: WsState
  aiStatus: AiStatus | null
  /** ツリー側から選択したとき、ボードにパンを要求するためのフラグ */
  panRequestId: string | null
  /** ツリーの見出しクリックでエディタ内ブロックへのスクロールを要求（BlockNoteのblock id） */
  docScrollBlockId: string | null

  setActiveBoard: (id: string | null) => void
  setActiveDoc: (id: string | null) => void
  setSelected: (ids: string[], opts?: { pan?: boolean }) => void
  setPanelTab: (tab: PanelTab) => void
  toggleSidebar: () => void
  togglePanel: () => void
  setWsState: (s: WsState) => void
  setAiStatus: (s: AiStatus | null) => void
  clearPanRequest: () => void
  requestDocScroll: (blockId: string) => void
  clearDocScroll: () => void
}

export const useUiStore = create<UiState>((set) => ({
  activeBoardId: null,
  activeDocId: null,
  selectedIds: [],
  panelTab: 'comments',
  sidebarOpen: true,
  panelOpen: true,
  wsState: 'connecting',
  aiStatus: null,
  panRequestId: null,
  docScrollBlockId: null,

  setActiveBoard: (id) => set({ activeBoardId: id }),
  setActiveDoc: (id) => set({ activeDocId: id }),
  requestDocScroll: (blockId) => set({ docScrollBlockId: blockId }),
  clearDocScroll: () => set({ docScrollBlockId: null }),
  setSelected: (ids, opts) =>
    set({ selectedIds: ids, panRequestId: opts?.pan && ids.length === 1 ? ids[0] : null }),
  setPanelTab: (tab) => set({ panelTab: tab }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setWsState: (wsState) => set({ wsState }),
  setAiStatus: (aiStatus) => set({ aiStatus }),
  clearPanRequest: () => set({ panRequestId: null }),
}))
