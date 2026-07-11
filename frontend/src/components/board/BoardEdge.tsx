import { useRef, useState } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getSmoothStepPath,
  useInternalNode,
  useReactFlow,
  type EdgeProps,
  type Edge,
  type InternalNode,
} from '@xyflow/react'
import { cn } from '@/lib/utils'
import { useEntityStore } from '@/stores/entity-store'
import { useHistoryStore } from '@/stores/history-store'
import { STROKE_COLORS } from './BoardNodes'
import type { EdgeAnchor, EdgeShape, EdgeSide, StickyColor } from '@/types/model'

export interface BoardEdgeFlowData {
  bend?: { x: number; y: number } | null
  shape?: EdgeShape
  color?: StickyColor
  strokeWidth?: number
  sourceAnchor?: EdgeAnchor | null
  targetAnchor?: EdgeAnchor | null
  [key: string]: unknown
}

export type BoardFlowEdge = Edge<BoardEdgeFlowData>

/** これ未満のオフセットは「ほぼ中央」とみなして調整を解除する（FigJam のスナップ挙動） */
const STRAIGHTEN_THRESHOLD = 8

const SIDE_POSITION: Record<EdgeSide, Position> = {
  t: Position.Top,
  r: Position.Right,
  b: Position.Bottom,
  l: Position.Left,
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
  cx: number
  cy: number
}

function nodeRect(node: InternalNode): Rect {
  const { x, y } = node.internals.positionAbsolute
  const w = node.measured.width ?? 0
  const h = node.measured.height ?? 0
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 }
}

/** アンカー（辺 + 0..1 の割合）→ ノード外周上の絶対座標 */
function anchorPoint(rect: Rect, a: EdgeAnchor): { x: number; y: number; side: EdgeSide } {
  switch (a.side) {
    case 't':
      return { x: rect.x + rect.w * a.t, y: rect.y, side: 't' }
    case 'b':
      return { x: rect.x + rect.w * a.t, y: rect.y + rect.h, side: 'b' }
    case 'l':
      return { x: rect.x, y: rect.y + rect.h * a.t, side: 'l' }
    case 'r':
      return { x: rect.x + rect.w, y: rect.y + rect.h * a.t, side: 'r' }
  }
}

/** アンカー未設定のレガシーエッジ用: 相手方向の最寄り辺の中央に自動接続 */
function autoAttach(rect: Rect, toward: { x: number; y: number }): { x: number; y: number; side: EdgeSide } {
  const dx = toward.x - rect.cx
  const dy = toward.y - rect.cy
  if (Math.abs(dx) * rect.h >= Math.abs(dy) * rect.w) {
    return dx >= 0 ? { x: rect.x + rect.w, y: rect.cy, side: 'r' } : { x: rect.x, y: rect.cy, side: 'l' }
  }
  return dy >= 0 ? { x: rect.cx, y: rect.y + rect.h, side: 'b' } : { x: rect.cx, y: rect.y, side: 't' }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** ポインタ位置に最も近いノード外周上のアンカーを求める（端点ドラッグ用） */
function nearestPerimeterAnchor(rect: Rect, p: { x: number; y: number }): EdgeAnchor {
  const dt = Math.abs(p.y - rect.y)
  const db = Math.abs(p.y - (rect.y + rect.h))
  const dl = Math.abs(p.x - rect.x)
  const dr = Math.abs(p.x - (rect.x + rect.w))
  // 矩形の外側にいる場合も自然に近い辺が選ばれるよう、外周までの距離で比較する
  const min = Math.min(dt, db, dl, dr)
  if (min === dt) return { side: 't', t: clamp01((p.x - rect.x) / (rect.w || 1)) }
  if (min === db) return { side: 'b', t: clamp01((p.x - rect.x) / (rect.w || 1)) }
  if (min === dl) return { side: 'l', t: clamp01((p.y - rect.y) / (rect.h || 1)) }
  return { side: 'r', t: clamp01((p.y - rect.y) / (rect.h || 1)) }
}

const SHAPE_OPTIONS: { key: EdgeShape; title: string }[] = [
  { key: 'straight', title: '直線' },
  { key: 'elbow', title: '折れ線（水平垂直）' },
  { key: 'curved', title: '曲線' },
]

const WIDTH_OPTIONS = [1.5, 2.5, 4]

/**
 * FigJam 風のエッジ。
 * - 接続位置は sourceAnchor/targetAnchor（辺 + 位置割合）としてユーザーが管理する。
 *   接続作成時はドラッグ元/先ハンドルの辺の中央、以後は端点ドラッグで外周上を自由に移動できる。
 * - 線種は 直線 / 折れ線（角丸の水平垂直）/ 曲線 を選択でき、
 *   折れ線・曲線は中央ハンドルのドラッグで経路を調整できる（bend として永続化）。
 * - 選択時にフローティングツールバーで線種・色・太さを変更できる。
 */
export function BoardEdge({ id, source, target, selected, markerEnd, style, label, data }: EdgeProps<BoardFlowEdge>) {
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  const { screenToFlowPosition } = useReactFlow()
  const updateEdge = useEntityStore((s) => s.updateEdge)

  // ドラッグ中はローカル状態でプレビューし、離した時点でストアへ永続化する
  const [dragBend, setDragBend] = useState<{ x: number; y: number } | null>(null)
  const [dragAnchor, setDragAnchor] = useState<{ end: 'source' | 'target'; anchor: EdgeAnchor } | null>(null)
  const bendDraggingRef = useRef(false)
  const anchorDraggingRef = useRef<'source' | 'target' | null>(null)

  if (!sourceNode || !targetNode) return null

  const sr = nodeRect(sourceNode)
  const tr = nodeRect(targetNode)

  const shape: EdgeShape = data?.shape ?? (data?.bend ? 'curved' : 'straight')
  const sourceAnchor = dragAnchor?.end === 'source' ? dragAnchor.anchor : (data?.sourceAnchor ?? null)
  const targetAnchor = dragAnchor?.end === 'target' ? dragAnchor.anchor : (data?.targetAnchor ?? null)

  const sp = sourceAnchor ? anchorPoint(sr, sourceAnchor) : autoAttach(sr, { x: tr.cx, y: tr.cy })
  const tp = targetAnchor ? anchorPoint(tr, targetAnchor) : autoAttach(tr, { x: sr.cx, y: sr.cy })

  const baseMid = { x: (sp.x + tp.x) / 2, y: (sp.y + tp.y) / 2 }
  const bend = bendDraggingRef.current ? dragBend : (data?.bend ?? null)

  // 線種ごとのパスと、中央ハンドル・ラベルの位置
  let path: string
  let handlePos = baseMid
  if (shape === 'curved') {
    const apex = bend ? { x: baseMid.x + bend.x, y: baseMid.y + bend.y } : baseMid
    // 2次ベジェが t=0.5 で apex を通るように制御点を決める
    const ctrl = { x: 2 * apex.x - baseMid.x, y: 2 * apex.y - baseMid.y }
    path = bend ? `M ${sp.x},${sp.y} Q ${ctrl.x},${ctrl.y} ${tp.x},${tp.y}` : `M ${sp.x},${sp.y} L ${tp.x},${tp.y}`
    handlePos = apex
  } else if (shape === 'elbow') {
    const center = bend ? { x: baseMid.x + bend.x, y: baseMid.y + bend.y } : undefined
    const [d, labelX, labelY] = getSmoothStepPath({
      sourceX: sp.x,
      sourceY: sp.y,
      sourcePosition: SIDE_POSITION[sp.side],
      targetX: tp.x,
      targetY: tp.y,
      targetPosition: SIDE_POSITION[tp.side],
      borderRadius: 8,
      centerX: center?.x,
      centerY: center?.y,
    })
    path = d
    handlePos = { x: labelX, y: labelY }
  } else {
    path = `M ${sp.x},${sp.y} L ${tp.x},${tp.y}`
  }

  const pushHistory = (prev: Partial<BoardEdgeFlowData>, next: Partial<BoardEdgeFlowData>) => {
    useHistoryStore.getState().push({
      undo: () => updateEdge(id, { data: prev }),
      redo: () => updateEdge(id, { data: next }),
    })
  }

  const commitData = (patch: Partial<BoardEdgeFlowData>) => {
    const prev: Partial<BoardEdgeFlowData> = {}
    for (const key of Object.keys(patch)) prev[key] = data?.[key] ?? null
    void updateEdge(id, { data: patch })
    pushHistory(prev, patch)
  }

  // --- 中央ハンドル: 曲げ / 折れ線の中間位置調整 ---
  const onBendPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    bendDraggingRef.current = true
    setDragBend(bend)
  }
  const onBendPointerMove = (e: React.PointerEvent) => {
    if (!bendDraggingRef.current) return
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const next = { x: pos.x - baseMid.x, y: pos.y - baseMid.y }
    setDragBend(Math.hypot(next.x, next.y) < STRAIGHTEN_THRESHOLD ? null : next)
  }
  const onBendPointerUp = () => {
    if (!bendDraggingRef.current) return
    bendDraggingRef.current = false
    const prevBend = data?.bend ?? null
    const nextBend = dragBend
    setDragBend(null)
    if (JSON.stringify(prevBend) === JSON.stringify(nextBend)) return
    void updateEdge(id, { data: { bend: nextBend } })
    pushHistory({ bend: prevBend }, { bend: nextBend })
  }

  // --- 端点ハンドル: ノード外周上でアンカーを動かす ---
  const onAnchorPointerDown = (end: 'source' | 'target') => (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    anchorDraggingRef.current = end
  }
  const onAnchorPointerMove = (e: React.PointerEvent) => {
    const end = anchorDraggingRef.current
    if (!end) return
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const rect = end === 'source' ? sr : tr
    setDragAnchor({ end, anchor: nearestPerimeterAnchor(rect, pos) })
  }
  const onAnchorPointerUp = () => {
    const end = anchorDraggingRef.current
    anchorDraggingRef.current = null
    if (!end || !dragAnchor) return
    const key = end === 'source' ? 'sourceAnchor' : 'targetAnchor'
    const prev = data?.[key] ?? null
    const next = dragAnchor.anchor
    setDragAnchor(null)
    if (JSON.stringify(prev) === JSON.stringify(next)) return
    void updateEdge(id, { data: { [key]: next } })
    pushHistory({ [key]: prev }, { [key]: next })
  }

  const color = data?.color ?? 'gray'
  const strokeWidth = data?.strokeWidth ?? 2

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        {label ? (
          <div
            className="absolute rounded bg-white/90 px-1.5 py-0.5 text-[11px] text-neutral-700 shadow-sm"
            style={{ transform: `translate(-50%,-50%) translate(${handlePos.x}px,${handlePos.y}px)` }}
          >
            {label}
          </div>
        ) : null}
        {selected && (
          <>
            {/* 端点ハンドル（外周上を自由に移動できる） */}
            {(
              [
                ['source', sp],
                ['target', tp],
              ] as const
            ).map(([end, p]) => (
              <div
                key={end}
                className="nodrag nopan absolute h-3.5 w-3.5 cursor-move rounded-full border-2 border-sky-500 bg-white shadow"
                style={{
                  transform: `translate(-50%,-50%) translate(${p.x}px,${p.y}px)`,
                  pointerEvents: 'all',
                  zIndex: 1100,
                }}
                onPointerDown={onAnchorPointerDown(end)}
                onPointerMove={onAnchorPointerMove}
                onPointerUp={onAnchorPointerUp}
              />
            ))}
            {/* 中央ハンドル（直線では非表示） */}
            {shape !== 'straight' && (
              <div
                className="nodrag nopan absolute h-3 w-3 cursor-move rounded-full border-2 border-white bg-sky-500 shadow"
                style={{
                  transform: `translate(-50%,-50%) translate(${handlePos.x}px,${handlePos.y}px)`,
                  pointerEvents: 'all',
                  zIndex: 1100,
                }}
                onPointerDown={onBendPointerDown}
                onPointerMove={onBendPointerMove}
                onPointerUp={onBendPointerUp}
              />
            )}
            {/* フローティングツールバー: 線種 / 色 / 太さ */}
            <div
              className="nodrag nopan absolute flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 shadow-md"
              style={{
                transform: `translate(-50%,-100%) translate(${handlePos.x}px,${Math.min(sp.y, tp.y, handlePos.y) - 16}px)`,
                pointerEvents: 'all',
                zIndex: 1100,
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-0.5">
                {SHAPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    title={opt.title}
                    className={cn(
                      'flex h-6 w-6 items-center justify-center rounded hover:bg-neutral-100',
                      shape === opt.key && 'bg-neutral-200',
                    )}
                    onClick={() => commitData({ shape: opt.key })}
                  >
                    <svg viewBox="0 0 16 16" className="h-4 w-4 stroke-neutral-700" fill="none" strokeWidth={1.6}>
                      {opt.key === 'straight' && <path d="M2 13 L14 3" />}
                      {opt.key === 'elbow' && <path d="M2 13 L2 6 Q2 4 4 4 L14 4" />}
                      {opt.key === 'curved' && <path d="M2 13 Q8 -2 14 9" />}
                    </svg>
                  </button>
                ))}
              </div>
              <div className="h-4 w-px bg-neutral-200" />
              <div className="flex items-center gap-1">
                {(Object.keys(STROKE_COLORS) as StickyColor[]).map((c) => (
                  <button
                    key={c}
                    title={c}
                    className={cn(
                      'h-4 w-4 rounded-full border border-black/10',
                      color === c && 'ring-2 ring-offset-1 ring-neutral-500',
                    )}
                    style={{ backgroundColor: STROKE_COLORS[c] }}
                    onClick={() => commitData({ color: c })}
                  />
                ))}
              </div>
              <div className="h-4 w-px bg-neutral-200" />
              <div className="flex items-center gap-0.5">
                {WIDTH_OPTIONS.map((w) => (
                  <button
                    key={w}
                    title={`太さ ${w}`}
                    className={cn(
                      'flex h-6 w-6 items-center justify-center rounded hover:bg-neutral-100',
                      strokeWidth === w && 'bg-neutral-200',
                    )}
                    onClick={() => commitData({ strokeWidth: w })}
                  >
                    <div className="w-4 rounded-full bg-neutral-700" style={{ height: `${w}px` }} />
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </EdgeLabelRenderer>
    </>
  )
}
