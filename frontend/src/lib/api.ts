import type { AiJob, AiStatus, KEdge, KNode, NodeType } from '@/types/model'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.error?.message) message = body.error.message
    } catch {
      // keep default message
    }
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export interface UpsertNodeRequest {
  id: string
  workspaceId: string
  parentId: string | null
  type: NodeType
  name: string
  orderKey: string
  data: Record<string, unknown>
}

export const api = {
  workspace: () => request<KNode>('/api/workspace'),
  listNodes: (workspaceId: string) => request<KNode[]>(`/api/nodes?workspaceId=${workspaceId}`),
  upsertNode: (body: UpsertNodeRequest) =>
    request<KNode>('/api/nodes', { method: 'POST', body: JSON.stringify(body) }),
  patchNode: (id: string, body: { name?: string; parentId?: string; orderKey?: string; data?: Record<string, unknown> }) =>
    request<KNode>(`/api/nodes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteNode: (id: string) => request<void>(`/api/nodes/${id}`, { method: 'DELETE' }),

  listEdges: (workspaceId: string) => request<KEdge[]>(`/api/edges?workspaceId=${workspaceId}`),
  upsertEdge: (body: Omit<KEdge, 'createdAt' | 'updatedAt'>) =>
    request<KEdge>('/api/edges', { method: 'POST', body: JSON.stringify(body) }),
  deleteEdge: (id: string) => request<void>(`/api/edges/${id}`, { method: 'DELETE' }),

  aiStatus: () => request<AiStatus>('/api/ai/status'),
  createAiJob: (body: { type: string; boardId: string; prompt?: string }) =>
    request<AiJob>('/api/ai/jobs', { method: 'POST', body: JSON.stringify(body) }),
  getAiJob: (id: string) => request<AiJob>(`/api/ai/jobs/${id}`),

  /** multipart/form-data のため JSON 用の request() ヘルパーは使わない（Content-Typeを固定しないこと） */
  uploadFile: async (file: File): Promise<{ url: string }> => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/files', { method: 'POST', body: form })
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`
      try {
        const body = await res.json()
        if (body?.error?.message) message = body.error.message
      } catch {
        // keep default message
      }
      throw new Error(message)
    }
    return (await res.json()) as { url: string }
  },
}
