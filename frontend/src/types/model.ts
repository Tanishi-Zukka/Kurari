export type NodeType =
  | 'workspace'
  | 'project'
  | 'board'
  | 'sticky'
  | 'text_card'
  | 'shape'
  | 'drawing'
  | 'image'
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

export type StickyColor = 'yellow' | 'blue' | 'pink' | 'green' | 'gray'
export type ShapeKind = 'rect' | 'ellipse'

export interface StickyData {
  text: string
  color: StickyColor
  x: number
  y: number
  w: number
  h: number
}

/** shape は StickyData + kind、text_card は color を使わない（同じ形で扱う） */
export interface BoardItemData extends StickyData {
  kind?: ShapeKind
}

export interface KEdge {
  id: string
  workspaceId: string
  boardId: string
  sourceNodeId: string
  targetNodeId: string
  label: string
  data: EdgeData
  createdAt: string
  updatedAt: string
}

export type EdgeShape = 'straight' | 'elbow' | 'curved'
export type EdgeSide = 't' | 'r' | 'b' | 'l'

/** ノード外周上の接続位置。side の辺上を 0..1 の割合 t で表す */
export interface EdgeAnchor {
  side: EdgeSide
  t: number
}

/**
 * 矢印の描画属性。
 * - bend: 中点からのオフセット（curved の曲げ量 / elbow の中間セグメント位置）
 * - anchor が null/未定義のエッジは相手方向の最寄り辺に自動接続（レガシー互換）
 */
export interface EdgeData {
  bend?: { x: number; y: number } | null
  shape?: EdgeShape
  color?: StickyColor
  strokeWidth?: number
  sourceAnchor?: EdgeAnchor | null
  targetAnchor?: EdgeAnchor | null
  [key: string]: unknown
}

/** ボードにキャンバス要素として描画されるノード種別 */
export const BOARD_ITEM_TYPES: NodeType[] = ['sticky', 'text_card', 'shape', 'drawing', 'image']

export interface DrawingData {
  points: { x: number; y: number }[]
  color: StickyColor
  strokeWidth: number
  x: number
  y: number
  w: number
  h: number
}

export interface ImageData {
  url: string
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

export function stickyData(node: KNode): BoardItemData {
  const d = node.data as Partial<BoardItemData>
  return {
    text: d.text ?? '',
    color: d.color ?? 'yellow',
    kind: d.kind,
    x: d.x ?? 0,
    y: d.y ?? 0,
    w: d.w ?? 220,
    h: d.h ?? 120,
  }
}

export function drawingData(node: KNode): DrawingData {
  const d = node.data as Partial<DrawingData>
  return {
    points: d.points ?? [],
    color: d.color ?? 'gray',
    strokeWidth: d.strokeWidth ?? 2,
    x: d.x ?? 0,
    y: d.y ?? 0,
    w: d.w ?? 200,
    h: d.h ?? 200,
  }
}

export function imageData(node: KNode): ImageData {
  const d = node.data as Partial<ImageData>
  return {
    url: d.url ?? '',
    x: d.x ?? 0,
    y: d.y ?? 0,
    w: d.w ?? 320,
    h: d.h ?? 220,
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
  | { type: 'edge.created' | 'edge.updated' | 'edge.deleted'; payload: KEdge }
  | { type: 'ai_job.updated'; payload: AiJob }
