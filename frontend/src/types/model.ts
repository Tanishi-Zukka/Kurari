export type NodeType =
  | 'workspace'
  | 'project'
  | 'board'
  | 'sticky'
  | 'text_card'
  | 'shape'
  | 'group'
  | 'document'
  | 'block'
  | 'chat_room'
  | 'message'
  | 'comment'
  | 'ai_summary'
  | 'decision'
  | 'open_question'
  | 'task'
  | 'link'

export interface KNode {
  id: string
  workspaceId: string
  parentId: string | null
  type: NodeType
  name: string
  orderKey: string
  data: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type StickyColor = 'yellow' | 'blue' | 'pink' | 'green'

export interface StickyData {
  text: string
  color: StickyColor
  x: number
  y: number
  w: number
  h: number
}

export interface CommentData {
  text: string
  author: string
}

export interface AiSummaryData {
  text: string
  provider: string
  sourceNodeId: string
  prompt: string
}

export function stickyData(node: KNode): StickyData {
  const d = node.data as Partial<StickyData>
  return {
    text: d.text ?? '',
    color: d.color ?? 'yellow',
    x: d.x ?? 0,
    y: d.y ?? 0,
    w: d.w ?? 220,
    h: d.h ?? 120,
  }
}

export type AiJobStatus = 'pending' | 'claimed' | 'done' | 'failed'

export interface AiJob {
  id: string
  type: string
  status: AiJobStatus
  payload: Record<string, unknown>
  result: string | null
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface AiStatus {
  agent: 'online' | 'offline'
  mockMode: boolean
  lastSeenAt: string | null
}

export type ServerEvent =
  | { type: 'node.created' | 'node.updated' | 'node.deleted'; payload: KNode }
  | { type: 'ai_job.updated'; payload: AiJob }
