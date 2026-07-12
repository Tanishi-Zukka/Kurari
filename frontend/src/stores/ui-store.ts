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
  /** 選択中のAI実行エンジン（copilot-cli / apple-ai / ollama）。localStorage に永続化 */
  aiRunner: string | null
  /** ツリー側から選択したとき、ボードにパンを要求するためのフラグ */
  panRequestId: string | null
  /** flow 座標を直接指定したパン要求（プレゼンスの「相手の場所へジャンプ」用） */
  panPointRequest: { x: number; y: number } | null
  /** ツリーの見出しクリックでエディタ内ブロックへのスクロールを要求（BlockNoteのblock id） */
  docScrollBlockId: string | null
  /** 接続ハンドルを常時表示するか（トグル可能。既定は選択/ホバー時のみ表示） */
  showHandles: boolean

  setActiveBoard: (id: string | null) => void
  setActiveDoc: (id: string | null) => void
  setSelected: (ids: string[], opts?: { pan?: boolean }) => void
  setPanelTab: (tab: PanelTab) => void
  toggleSidebar: () => void
  togglePanel: () => void
  setWsState: (s: WsState) => void
  setAiStatus: (s: AiStatus | null) => void
  setAiRunner: (id: string) => void
  clearPanRequest: () => void
  requestPanPoint: (p: { x: number; y: number }) => void
  clearPanPointRequest: () => void
  requestDocScroll: (blockId: string) => void
  clearDocScroll: () => void
  toggleShowHandles: () => void
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
  aiRunner: localStorage.getItem('kurari.aiRunner'),
  panRequestId: null,
  panPointRequest: null,
  docScrollBlockId: null,
  showHandles: false,

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
  setAiRunner: (id) => {
    localStorage.setItem('kurari.aiRunner', id)
    set({ aiRunner: id })
  },
  clearPanRequest: () => set({ panRequestId: null }),
  requestPanPoint: (p) => set({ panPointRequest: p }),
  clearPanPointRequest: () => set({ panPointRequest: null }),
  toggleShowHandles: () => set((s) => ({ showHandles: !s.showHandles })),
}))
