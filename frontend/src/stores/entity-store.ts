import { create } from 'zustand'
import { api } from '@/lib/api'
import type { KEdge, KNode, NodeType, ServerEvent } from '@/types/model'

interface EntityState {
  nodes: Record<string, KNode>
  edges: Record<string, KEdge>
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
  /** undo による削除の取り消し。id を含む完全な KNode を渡して復元する */
  restoreNode: (node: KNode) => Promise<void>
  createEdge: (input: {
    boardId: string
    sourceNodeId: string
    targetNodeId: string
    label?: string
    data?: Record<string, unknown>
  }) => Promise<KEdge>
  updateEdge: (id: string, patch: { label?: string; data?: Record<string, unknown> }) => Promise<void>
  removeEdge: (id: string) => Promise<void>
  /** undo による削除の取り消し。id を含む完全な KEdge を渡して復元する */
  restoreEdge: (edge: KEdge) => Promise<void>
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
  edges: {},
  workspaceId: null,
  loaded: false,
  loadError: null,

  load: async () => {
    try {
      const ws = await api.workspace()
      const [list, edgeList] = await Promise.all([
        api.listNodes(ws.workspaceId),
        api.listEdges(ws.workspaceId),
      ])
      const nodes: Record<string, KNode> = {}
      for (const n of list) nodes[n.id] = n
      const edges: Record<string, KEdge> = {}
      for (const e of edgeList) edges[e.id] = e
      set({ nodes, edges, workspaceId: ws.workspaceId, loaded: true, loadError: null })
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

  restoreNode: async (node) => {
    set((s) => ({ nodes: { ...s.nodes, [node.id]: node } }))
    try {
      const saved = await api.upsertNode(node)
      set((s) => ({ nodes: { ...s.nodes, [saved.id]: saved } }))
    } catch (e) {
      set((s) => {
        const next = { ...s.nodes }
        delete next[node.id]
        return { nodes: next }
      })
      throw e
    }
  },

  createEdge: async ({ boardId, sourceNodeId, targetNodeId, label = '', data = {} }) => {
    const workspaceId = get().workspaceId
    if (!workspaceId) throw new Error('workspace not loaded')
    const now = new Date().toISOString()
    const edge: KEdge = {
      id: crypto.randomUUID(),
      workspaceId,
      boardId,
      sourceNodeId,
      targetNodeId,
      label,
      data,
      createdAt: now,
      updatedAt: now,
    }
    set((s) => ({ edges: { ...s.edges, [edge.id]: edge } }))
    try {
      const saved = await api.upsertEdge(edge)
      set((s) => ({ edges: { ...s.edges, [saved.id]: saved } }))
      return saved
    } catch (e) {
      set((s) => {
        const next = { ...s.edges }
        delete next[edge.id]
        return { edges: next }
      })
      throw e
    }
  },

  updateEdge: async (id, patch) => {
    const prev = get().edges[id]
    if (!prev) return
    const optimistic: KEdge = {
      ...prev,
      label: patch.label ?? prev.label,
      data: patch.data ? { ...prev.data, ...patch.data } : prev.data,
      updatedAt: new Date().toISOString(),
    }
    set((s) => ({ edges: { ...s.edges, [id]: optimistic } }))
    try {
      const saved = await api.upsertEdge(optimistic)
      set((s) => ({ edges: { ...s.edges, [saved.id]: saved } }))
    } catch (e) {
      set((s) => ({ edges: { ...s.edges, [id]: prev } }))
      throw e
    }
  },

  removeEdge: async (id) => {
    const snapshot = get().edges
    if (!snapshot[id]) return
    set((s) => {
      const next = { ...s.edges }
      delete next[id]
      return { edges: next }
    })
    try {
      await api.deleteEdge(id)
    } catch (e) {
      set({ edges: snapshot })
      throw e
    }
  },

  restoreEdge: async (edge) => {
    set((s) => ({ edges: { ...s.edges, [edge.id]: edge } }))
    try {
      const saved = await api.upsertEdge(edge)
      set((s) => ({ edges: { ...s.edges, [saved.id]: saved } }))
    } catch (e) {
      set((s) => {
        const next = { ...s.edges }
        delete next[edge.id]
        return { edges: next }
      })
      throw e
    }
  },

  applyServerEvent: (ev) => {
    if (ev.type === 'edge.created' || ev.type === 'edge.updated') {
      set((s) => ({ edges: { ...s.edges, [ev.payload.id]: ev.payload } }))
      return
    }
    if (ev.type === 'edge.deleted') {
      set((s) => {
        if (!s.edges[ev.payload.id]) return s
        const next = { ...s.edges }
        delete next[ev.payload.id]
        return { edges: next }
      })
      return
    }
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
