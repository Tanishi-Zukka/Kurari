export type NodeType =
  | 'workspace'
  | 'project'
  | 'board'
  | 'sticky'
  | 'text_card'
  | 'shape'
  | 'drawing'
  | 'image'
  | 'section'
  | 'group'
  | 'document'
  | 'block'
  | 'chat_room'
  | 'message'
  | 'comment'
  | 'comment_pin'
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
  /** true なら塗りを半透明で描画する */
  translucent?: boolean
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
 * - bend: curved の曲げ量（S字基準の中点からのオフセット）
 * - elbow.coords: 折れ線の中間セグメントの交差座標列（出発軸から交互に、縦ランの列x / 横ランの行y）。
 *   未設定なら自動ルーティング（スタブ+ノード迂回）
 * - sourceFree/targetFree: ノードに接続しないフリー端点の絶対座標。
 *   anchor / free がどちらも無い端点は相手方向の最寄り辺に自動接続（レガシー互換）
 */
export interface EdgeData {
  bend?: { x: number; y: number } | null
  elbow?: { coords?: number[] } | null
  shape?: EdgeShape
  color?: StickyColor
  strokeWidth?: number
  sourceAnchor?: EdgeAnchor | null
  targetAnchor?: EdgeAnchor | null
  sourceFree?: { x: number; y: number } | null
  targetFree?: { x: number; y: number } | null
  [key: string]: unknown
}

/** ボードにキャンバス要素として描画されるノード種別（セクションは別扱い） */
export const BOARD_ITEM_TYPES: NodeType[] = ['sticky', 'text_card', 'shape', 'drawing', 'image', 'comment_pin']

/**
 * ボード要素の絶対座標。セクション配下の要素は data.x/y をセクション相対で持つため、
 * セクションの入れ子を親方向にたどって原点を積算する。
 */
export function absoluteXY(nodes: Record<string, KNode>, node: KNode): { x: number; y: number } {
  const d = node.data as { x?: number; y?: number }
  let x = d.x ?? 0
  let y = d.y ?? 0
  let parent = node.parentId ? nodes[node.parentId] : undefined
  while (parent?.type === 'section') {
    const pd = parent.data as { x?: number; y?: number }
    x += pd.x ?? 0
    y += pd.y ?? 0
    parent = parent.parentId ? nodes[parent.parentId] : undefined
  }
  return { x, y }
}

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
  authorColor?: StickyColor
  authorClientId?: string
}

export interface CommentPinData {
  x: number
  y: number
  w: number
  h: number
  authorName: string
  authorColor: StickyColor
  resolved?: boolean
}

export type ReactionMap = Record<string, string[]>

export function reactionsOf(node: KNode): ReactionMap {
  const value = node.data.reactions
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string[]] =>
      Array.isArray(entry[1]) && entry[1].every((id) => typeof id === 'string'),
    ),
  )
}

export function commentPinData(node: KNode): CommentPinData {
  const d = node.data as Partial<CommentPinData>
  return {
    x: d.x ?? 0,
    y: d.y ?? 0,
    w: d.w ?? 28,
    h: d.h ?? 28,
    authorName: d.authorName ?? '匿名',
    authorColor: d.authorColor ?? 'gray',
    resolved: d.resolved,
  }
}

/**
 * 派生操作の共通規約: メッセージ・付箋から「タスク化 / 意思決定ログ化 / 付箋化」で
 * 作られたノードは data.derivedFrom に元ノードの id を持ち、出所へジャンプできる。
 * 元ノードは変換せずに残す（type の書き換えはしない）。
 */
export interface TaskAssignee {
  clientId: string
  name: string
  color: StickyColor
}

export type TaskStatus = 'todo' | 'doing' | 'done'
export const TASK_STATUSES: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: '未着手' },
  { status: 'doing', label: '進行中' },
  { status: 'done', label: '完了' },
]

export interface TaskData {
  text: string
  done: boolean
  derivedFrom?: string
  dueDate?: string
  assignee?: TaskAssignee
  status?: TaskStatus
}

/** decision / open_question 共用（既存の { text } と後方互換） */
export interface DecisionData {
  text: string
  derivedFrom?: string
}

export function taskData(node: KNode): TaskData {
  const d = node.data as Record<string, unknown>
  const rawAssignee = d.assignee
  let assignee: TaskAssignee | undefined
  if (rawAssignee && typeof rawAssignee === 'object' && !Array.isArray(rawAssignee)) {
    const value = rawAssignee as Record<string, unknown>
    if (typeof value.clientId === 'string' && typeof value.name === 'string') {
      const colors: StickyColor[] = ['yellow', 'blue', 'pink', 'green', 'gray']
      assignee = {
        clientId: value.clientId,
        name: value.name,
        color: colors.includes(value.color as StickyColor) ? value.color as StickyColor : 'gray',
      }
    }
  }
  return {
    text: typeof d.text === 'string' ? d.text : '',
    done: typeof d.done === 'boolean' ? d.done : false,
    derivedFrom: typeof d.derivedFrom === 'string' ? d.derivedFrom : undefined,
    dueDate: typeof d.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.dueDate) ? d.dueDate : undefined,
    assignee,
    status: d.status === 'todo' || d.status === 'doing' || d.status === 'done' ? d.status : undefined,
  }
}

export function taskStatus(node: KNode): TaskStatus {
  const status = (node.data as { status?: unknown }).status
  if (status === 'todo' || status === 'doing' || status === 'done') return status
  return taskData(node).done ? 'done' : 'todo'
}

export function taskStatusPatch(status: TaskStatus): { status: TaskStatus; done: boolean } {
  return { status, done: status === 'done' }
}

export function localToday(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function isTaskOverdue(task: TaskData): boolean {
  return !!task.dueDate && task.dueDate < localToday() && !task.done
}

/** 派生元参照。どの type のノードでも読める */
export function derivedFromOf(node: KNode): string | null {
  const v = (node.data as { derivedFrom?: unknown }).derivedFrom
  return typeof v === 'string' ? v : null
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
    translucent: d.translucent ?? false,
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

export interface AiRunnerInfo {
  id: string
  label: string
}

export interface AiStatus {
  agent: 'online' | 'offline'
  mockMode: boolean
  lastSeenAt: string | null
  /** online のとき、Agent が利用できる実行エンジン一覧（ページ側で選択する） */
  runners?: AiRunnerInfo[]
}

export type PresenceMode = 'board' | 'doc' | 'tasks' | 'ai' | 'call'

/** ボード上のカーソル位置（flow 座標） */
export interface PresenceCursor {
  x: number
  y: number
}

/** 「どの画面のどこを見ているか」。doc 編集中は editing=true */
export interface PresenceLocation {
  mode: PresenceMode
  boardId?: string | null
  docId?: string | null
  editing?: boolean
}

/** 接続中クライアント1つ分のプレゼンス。sessionId はサーバ採番（同一人物の複数タブは別エントリ） */
export interface PresencePeer {
  sessionId: string
  clientId: string
  name: string
  color: StickyColor
  location: PresenceLocation
  cursor: PresenceCursor | null
  selectedIds: string[]
}

/** 通話参加者1人分。名前・色は presence の peers から引く */
export interface CallParticipant {
  sessionId: string
  muted: boolean
  cameraOff: boolean
  screenStreamId: string | null
}

export interface TimerState {
  phase: 'idle' | 'running' | 'paused'
  endsAt: number | null
  remainingMs: number
  durationMs: number
  startedBy: string | null
}

export type ServerEvent =
  | { type: 'node.created' | 'node.updated' | 'node.deleted'; payload: KNode }
  | { type: 'edge.created' | 'edge.updated' | 'edge.deleted'; payload: KEdge }
  | { type: 'ai_job.updated'; payload: AiJob }
  | { type: 'presence.joined'; payload: { sessionId: string; peers: PresencePeer[] } }
  | { type: 'presence.peers'; payload: PresencePeer[] }
  | { type: 'presence.updated'; payload: PresencePeer }
  | { type: 'reaction.ping'; payload: { emoji: string; x: number; y: number; boardId: string; sessionId: string; name: string; color: StickyColor } }
  | { type: 'timer.state'; payload: TimerState }
  | { type: 'access.requested'; payload: { requestId: string; name: string; requestedAt: string } }
  | { type: 'access.resolved'; payload: { requestId: string; status: string } }
  | { type: 'call.joined'; payload: { participants: CallParticipant[] } }
  | { type: 'call.participants'; payload: CallParticipant[] }
  | {
      type: 'call.signal'
      payload: {
        from: string
        description?: RTCSessionDescriptionInit
        candidate?: RTCIceCandidateInit | null
      }
    }
