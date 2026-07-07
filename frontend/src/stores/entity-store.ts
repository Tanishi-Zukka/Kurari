import { create } from 'zustand'
import { api } from '@/lib/api'
import type { KNode, NodeType, ServerEvent } from '@/types/model'

interface EntityState {
  nodes: Record<string, KNode>
  workspaceId: string | null
  loaded: boolean
  loadError: string | null

  load: () => Promise<void>
  createNode: (input: {
    parentId: string | null
    type: NodeType
    name?: string
    orderKey?: string
    data?: Record<string, unknown>
  }) => Promise<KNode>
  updateNode: (id: string, patch: { name?: string; orderKey?: string; data?: Record<string, unknown> }) => Promise<void>
  removeNode: (id: string) => Promise<void>
  applyServerEvent: (ev: ServerEvent) => void
}

/** ローカルで id 以下の子孫をすべて集める（soft delete のカスケードをUIに反映するため） */
function descendantIds(nodes: Record<string, KNode>, rootId: string): string[] {
  const result: string[] = []
  const walk = (id: string) => {
    result.push(id)
    for (const n of Object.values(nodes)) {
      if (n.parentId === id) walk(n.id)
    }
  }
  walk(rootId)
  return result
}

export const useEntityStore = create<EntityState>((set, get) => ({
  nodes: {},
  workspaceId: null,
  loaded: false,
  loadError: null,

  load: async () => {
    try {
      const ws = await api.workspace()
      const list = await api.listNodes(ws.workspaceId)
      const nodes: Record<string, KNode> = {}
      for (const n of list) nodes[n.id] = n
      set({ nodes, workspaceId: ws.workspaceId, loaded: true, loadError: null })
    } catch (e) {
      set({ loadError: e instanceof Error ? e.message : String(e), loaded: false })
    }
  },

  createNode: async ({ parentId, type, name = '', orderKey = '', data = {} }) => {
    const workspaceId = get().workspaceId
    if (!workspaceId) throw new Error('workspace not loaded')
    const now = new Date().toISOString()
    const node: KNode = {
      id: crypto.randomUUID(),
      workspaceId,
      parentId,
      type,
      name,
      orderKey,
      data,
      createdAt: now,
      updatedAt: now,
    }
    // 楽観更新 → API → 失敗時ロールバック
    set((s) => ({ nodes: { ...s.nodes, [node.id]: node } }))
    try {
      const saved = await api.upsertNode(node)
      set((s) => ({ nodes: { ...s.nodes, [saved.id]: saved } }))
      return saved
    } catch (e) {
      set((s) => {
        const next = { ...s.nodes }
        delete next[node.id]
        return { nodes: next }
      })
      throw e
    }
  },

  updateNode: async (id, patch) => {
    const prev = get().nodes[id]
    if (!prev) return
    const optimistic: KNode = {
      ...prev,
      name: patch.name ?? prev.name,
      orderKey: patch.orderKey ?? prev.orderKey,
      data: patch.data ? { ...prev.data, ...patch.data } : prev.data,
      updatedAt: new Date().toISOString(),
    }
    set((s) => ({ nodes: { ...s.nodes, [id]: optimistic } }))
    try {
      const saved = await api.patchNode(id, patch)
      set((s) => ({ nodes: { ...s.nodes, [id]: saved } }))
    } catch (e) {
      set((s) => ({ nodes: { ...s.nodes, [id]: prev } }))
      throw e
    }
  },

  removeNode: async (id) => {
    const snapshot = get().nodes
    const ids = descendantIds(snapshot, id)
    set((s) => {
      const next = { ...s.nodes }
      for (const i of ids) delete next[i]
      return { nodes: next }
    })
    try {
      await api.deleteNode(id)
    } catch (e) {
      set({ nodes: snapshot })
      throw e
    }
  },

  applyServerEvent: (ev) => {
    if (ev.type === 'node.created' || ev.type === 'node.updated') {
      const incoming = ev.payload
      set((s) => {
        const current = s.nodes[incoming.id]
        // 自分の楽観更新の方が新しければ上書きしない
        if (current && current.updatedAt > incoming.updatedAt) return s
        return { nodes: { ...s.nodes, [incoming.id]: incoming } }
      })
    } else if (ev.type === 'node.deleted') {
      set((s) => {
        if (!s.nodes[ev.payload.id]) return s
        const next = { ...s.nodes }
        delete next[ev.payload.id]
        return { nodes: next }
      })
    }
  },
}))

/** parentId ごとの子ノード一覧（orderKey → createdAt 順） */
export function childrenOf(nodes: Record<string, KNode>, parentId: string | null): KNode[] {
  return Object.values(nodes)
    .filter((n) => n.parentId === parentId)
    .sort((a, b) => (a.orderKey || '').localeCompare(b.orderKey || '') || a.createdAt.localeCompare(b.createdAt))
}
