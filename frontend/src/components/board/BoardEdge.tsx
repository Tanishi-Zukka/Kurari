import { useRef, useState } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  useReactFlow,
  type EdgeProps,
  type Edge,
} from '@xyflow/react'
import { cn } from '@/lib/utils'
import { childrenOf, useEntityStore } from '@/stores/entity-store'
import { useHistoryStore } from '@/stores/history-store'
import { useUiStore } from '@/stores/ui-store'
import { STROKE_COLORS } from './BoardNodes'
import {
  BOARD_ITEM_TYPES,
  absoluteXY,
  type EdgeAnchor,
  type EdgeShape,
  type EdgeSide,
  type KNode,
  type StickyColor,
} from '@/types/model'

export interface BoardEdgeFlowData {
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

export type BoardFlowEdge = Edge<BoardEdgeFlowData>

interface Pt {
  x: number
  y: number
}

/** 端点。side が null のときはノードに接続しないフリー端点 */
interface EndPt extends Pt {
  side: EdgeSide | null
}

/** これ未満の調整量は「初期形状」にスナップして解除する */
const STRAIGHTEN_THRESHOLD = 8
/** 端点ドラッグ時、ノード外周からこの距離以内なら吸着する（フロー座標） */
const SNAP_DISTANCE = 14
/** 折れ線: アンカーから外向きに突き出すスタブの長さ */
const STUB = 20
/** 折れ線: ノードの箱をこの余白ぶん膨らませて迂回する */
const INFLATE = 12
/** 折れ線ルーティングの曲がり1回あたりのコスト（少ない曲がりを優先） */
const TURN_COST = 40

interface Rect {
  x: number
  y: number
  w: number
  h: number
  cx: number
  cy: number
}

/** ボード要素の絶対座標の矩形。セクション配下は相対座標なので絶対に変換する */
function rectOf(nodesMap: Record<string, KNode>, node: KNode): Rect {
  const d = node.data as { w?: number; h?: number }
  const { x, y } = absoluteXY(nodesMap, node)
  const w = d.w ?? 0
  const h = d.h ?? 0
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 }
}

function inflateXY(r: Rect, mx: number, my: number): Rect {
  return { x: r.x - mx, y: r.y - my, w: r.w + 2 * mx, h: r.h + 2 * my, cx: r.cx, cy: r.cy }
}

/** アンカー（辺 + 0..1 の割合）→ ノード外周上の絶対座標 */
function anchorPoint(rect: Rect, a: EdgeAnchor): EndPt {
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
function autoAttach(rect: Rect, toward: Pt): EndPt {
  const dx = toward.x - rect.cx
  const dy = toward.y - rect.cy
  if (Math.abs(dx) * rect.h >= Math.abs(dy) * rect.w) {
    return dx >= 0 ? { x: rect.x + rect.w, y: rect.cy, side: 'r' } : { x: rect.x, y: rect.cy, side: 'l' }
  }
  return dy >= 0 ? { x: rect.cx, y: rect.y + rect.h, side: 'b' } : { x: rect.cx, y: rect.y, side: 't' }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** ポインタ位置に最も近いノード外周上のアンカー（吸着用） */
function nearestPerimeterAnchor(rect: Rect, p: Pt): EdgeAnchor {
  const dt = Math.abs(p.y - rect.y)
  const db = Math.abs(p.y - (rect.y + rect.h))
  const dl = Math.abs(p.x - rect.x)
  const dr = Math.abs(p.x - (rect.x + rect.w))
  const min = Math.min(dt, db, dl, dr)
  if (min === dt) return { side: 't', t: clamp01((p.x - rect.x) / (rect.w || 1)) }
  if (min === db) return { side: 'b', t: clamp01((p.x - rect.x) / (rect.w || 1)) }
  if (min === dl) return { side: 'l', t: clamp01((p.y - rect.y) / (rect.h || 1)) }
  return { side: 'r', t: clamp01((p.y - rect.y) / (rect.h || 1)) }
}

/** 矩形の外周までの距離（内側にいるときは 0） */
function distToRect(p: Pt, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w))
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h))
  return Math.hypot(dx, dy)
}

/** フリー端点用: 相手の方向（水平/垂直の支配軸）を決める */
function sideToward(from: Pt, to: Pt): EdgeSide {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'r' : 'l'
  return dy >= 0 ? 'b' : 't'
}

const SIDE_NORMAL: Record<EdgeSide, Pt> = {
  t: { x: 0, y: -1 },
  b: { x: 0, y: 1 },
  l: { x: -1, y: 0 },
  r: { x: 1, y: 0 },
}

const sideIsH = (s: EdgeSide) => s === 'l' || s === 'r'

// 方向: 0:+x 1:-x 2:+y 3:-y
const DIRS: Pt[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
]
const reverseDir = (d: number) => (d === 0 ? 1 : d === 1 ? 0 : d === 2 ? 3 : 2)
const dirIndexOf = (v: Pt): number => (v.x > 0 ? 0 : v.x < 0 ? 1 : v.y > 0 ? 2 : 3)

/** 連続重複を除去し、一直線に並ぶ中間点をまとめる */
function cleanPolyline(points: Pt[]): Pt[] {
  const pts: Pt[] = []
  for (const p of points) {
    const last = pts[pts.length - 1]
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue
    pts.push(p)
  }
  const out: Pt[] = []
  for (let i = 0; i < pts.length; i++) {
    if (i > 0 && i < pts.length - 1) {
      const a = out[out.length - 1]
      const b = pts[i]
      const c = pts[i + 1]
      const colinear = (Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5)
      if (colinear) continue
    }
    out.push(pts[i])
  }
  return out
}

/** 折れ線ポリラインを角丸パスにする */
function roundedPath(points: Pt[], radius: number): string {
  const pts = cleanPolyline(points)
  if (pts.length === 0) return ''
  let d = `M ${pts[0].x},${pts[0].y}`
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]
    const cur = pts[i]
    const next = pts[i + 1]
    const v1 = { x: cur.x - prev.x, y: cur.y - prev.y }
    const v2 = { x: next.x - cur.x, y: next.y - cur.y }
    const l1 = Math.hypot(v1.x, v1.y)
    const l2 = Math.hypot(v2.x, v2.y)
    const r = Math.min(radius, l1 / 2, l2 / 2)
    if (r < 0.5 || v1.x * v2.y - v1.y * v2.x === 0) {
      d += ` L ${cur.x},${cur.y}`
      continue
    }
    const pin = { x: cur.x - (v1.x / l1) * r, y: cur.y - (v1.y / l1) * r }
    const pout = { x: cur.x + (v2.x / l2) * r, y: cur.y + (v2.y / l2) * r }
    d += ` L ${pin.x},${pin.y} Q ${cur.x},${cur.y} ${pout.x},${pout.y}`
  }
  const last = pts[pts.length - 1]
  d += ` L ${last.x},${last.y}`
  return d
}

/**
 * 疎グリッド上のダイクストラで A→B の直交経路を求める（FigJam 風の自動ルーティング）。
 * 候補線はスタブ点・障害物（膨張済みノード矩形）の外周・隙間の中間線のみなので小規模。
 * dirA: A に到達した時点の進行方向（スタブの向き）。entryDir: B→終点 の進行方向（null なら自由）。
 */
function autoRoute(A: Pt, dirA: number, B: Pt, entryDir: number | null, obstacles: Rect[]): Pt[] {
  const xs: number[] = [A.x, B.x, (A.x + B.x) / 2]
  const ys: number[] = [A.y, B.y, (A.y + B.y) / 2]
  for (const r of obstacles) {
    xs.push(r.x, r.x + r.w)
    ys.push(r.y, r.y + r.h)
  }
  if (obstacles.length === 2) {
    const [a, b] = obstacles
    if (a.x + a.w < b.x) xs.push((a.x + a.w + b.x) / 2)
    if (b.x + b.w < a.x) xs.push((b.x + b.w + a.x) / 2)
    if (a.y + a.h < b.y) ys.push((a.y + a.h + b.y) / 2)
    if (b.y + b.h < a.y) ys.push((b.y + b.h + a.y) / 2)
  }
  const uniq = (arr: number[]) => {
    const sorted = [...arr].sort((p, q) => p - q)
    const out: number[] = []
    for (const v of sorted) if (out.length === 0 || v - out[out.length - 1] > 0.01) out.push(v)
    return out
  }
  const X = uniq(xs)
  const Y = uniq(ys)
  const xi = (v: number) => X.findIndex((x) => Math.abs(x - v) <= 0.01)
  const yi = (v: number) => Y.findIndex((y) => Math.abs(y - v) <= 0.01)
  const ia = xi(A.x)
  const ja = yi(A.y)
  const ib = xi(B.x)
  const jb = yi(B.y)
  if (ia < 0 || ja < 0 || ib < 0 || jb < 0) return [A, { x: A.x, y: B.y }, B]

  // 障害物の内部（境界は通行可）と交差する区間は通れない
  const eps = 1
  const blockedH = (y: number, x1: number, x2: number) =>
    obstacles.some((r) => y > r.y + eps && y < r.y + r.h - eps && Math.max(x1, x2) > r.x + eps && Math.min(x1, x2) < r.x + r.w - eps)
  const blockedV = (x: number, y1: number, y2: number) =>
    obstacles.some((r) => x > r.x + eps && x < r.x + r.w - eps && Math.max(y1, y2) > r.y + eps && Math.min(y1, y2) < r.y + r.h - eps)

  const NX = X.length
  const NY = Y.length
  const stateId = (i: number, j: number, d: number) => (i * NY + j) * 4 + d
  const dist = new Array<number>(NX * NY * 4).fill(Infinity)
  const prev = new Array<number>(NX * NY * 4).fill(-1)
  const done = new Array<boolean>(NX * NY * 4).fill(false)
  dist[stateId(ia, ja, dirA)] = 0

  for (;;) {
    let best = -1
    let bestCost = Infinity
    for (let s = 0; s < dist.length; s++) {
      if (!done[s] && dist[s] < bestCost) {
        bestCost = dist[s]
        best = s
      }
    }
    if (best < 0) break
    done[best] = true
    const d = best % 4
    const j = Math.floor(best / 4) % NY
    const i = Math.floor(best / (4 * NY))
    for (let d2 = 0; d2 < 4; d2++) {
      if (d2 === reverseDir(d)) continue
      const step = DIRS[d2]
      const ni = i + step.x
      const nj = j + step.y
      if (ni < 0 || ni >= NX || nj < 0 || nj >= NY) continue
      if (step.x !== 0 && blockedH(Y[j], X[i], X[ni])) continue
      if (step.y !== 0 && blockedV(X[i], Y[j], Y[nj])) continue
      const len = step.x !== 0 ? Math.abs(X[ni] - X[i]) : Math.abs(Y[nj] - Y[j])
      const cost = dist[best] + len + (d2 !== d ? TURN_COST : 0)
      const sid = stateId(ni, nj, d2)
      if (cost < dist[sid]) {
        dist[sid] = cost
        prev[sid] = best
      }
    }
  }

  // ゴール: B に到達した状態のうち、終端スタブへの折り返し(180°)にならないもの
  let goal = -1
  let goalCost = Infinity
  for (let d = 0; d < 4; d++) {
    if (entryDir != null && d === reverseDir(entryDir)) continue
    const sid = stateId(ib, jb, d)
    const cost = dist[sid] + (entryDir != null && d !== entryDir ? TURN_COST : 0)
    if (cost < goalCost) {
      goalCost = cost
      goal = sid
    }
  }
  if (goal < 0 || !isFinite(goalCost)) return [A, { x: A.x, y: B.y }, B]

  const pts: Pt[] = []
  let s = goal
  while (s >= 0) {
    const j = Math.floor(s / 4) % NY
    const i = Math.floor(s / (4 * NY))
    pts.push({ x: X[i], y: Y[j] })
    s = prev[s]
  }
  return pts.reverse()
}

/** coords（交差座標列）からポリラインを再構築する */
function polylineFromCoords(sp: Pt, exitIsH: boolean, coords: number[], tp: Pt): Pt[] {
  const pts: Pt[] = [sp]
  let cur = sp
  let h = exitIsH
  for (const c of coords) {
    cur = h ? { x: c, y: cur.y } : { x: cur.x, y: c }
    pts.push(cur)
    h = !h
  }
  cur = h ? { x: tp.x, y: cur.y } : { x: cur.x, y: tp.y }
  pts.push(cur)
  pts.push(tp)
  return pts
}

/** ポリラインの中間セグメントの交差座標列を取り出す（polylineFromCoords の逆） */
function coordsFromPolyline(pts: Pt[]): number[] {
  const coords: number[] = []
  for (let i = 1; i < pts.length - 2; i++) {
    const horizontal = Math.abs(pts[i].y - pts[i + 1].y) < 0.5
    coords.push(horizontal ? pts[i].y : pts[i].x)
  }
  return coords
}

interface ElbowRun {
  coordIndex: number
  orient: 'h' | 'v'
  mid: Pt
}

/** ポリラインの中間セグメントからピルハンドル情報を作る */
function runsFromPolyline(pts: Pt[]): ElbowRun[] {
  const runs: ElbowRun[] = []
  for (let i = 1; i < pts.length - 2; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const horizontal = Math.abs(a.y - b.y) < 0.5
    runs.push({
      coordIndex: i - 1,
      orient: horizontal ? 'h' : 'v',
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    })
  }
  return runs
}

const SHAPE_OPTIONS: { key: EdgeShape; title: string }[] = [
  { key: 'straight', title: '直線' },
  { key: 'elbow', title: '折れ線（水平垂直）' },
  { key: 'curved', title: '曲線' },
]

const WIDTH_OPTIONS = [1.5, 2.5, 4]

type EndName = 'source' | 'target'

type EndPreview =
  | { end: EndName; kind: 'free'; p: Pt }
  | { end: EndName; kind: 'anchor'; nodeId: string; anchor: EdgeAnchor }

/**
 * FigJam 風のエッジ。
 * - 端点はノード外周のアンカーまたはフリー座標。ドラッグで自由に動かし、ノードの縁に吸着できる。
 * - 折れ線はアンカーの辺から外向きにスタブを出し、ノードの箱を迂回して自動ルーティングする。
 *   各中間セグメントはピルハンドルで個別に動かせる（coords として永続化）。
 * - 曲線は両辺から垂直に出るS字が初期形状で、中央ドラッグで曲がりを調整する。
 */
export function BoardEdge({ id, source, target, selected, markerEnd, style, label, data }: EdgeProps<BoardFlowEdge>) {
  const nodesMap = useEntityStore((s) => s.nodes)
  const updateEdge = useEntityStore((s) => s.updateEdge)
  const activeBoardId = useUiStore((s) => s.activeBoardId)
  const { screenToFlowPosition } = useReactFlow()

  // ドラッグ中はローカル状態でプレビューし、離した時点でストアへ永続化する
  const [dragBend, setDragBend] = useState<Pt | null>(null)
  const [dragElbow, setDragElbow] = useState<{ coords: number[]; index: number } | null>(null)
  const [dragEnd, setDragEnd] = useState<EndPreview | null>(null)
  const bendDraggingRef = useRef(false)
  const elbowDraggingRef = useRef<ElbowRun | null>(null)
  const endDraggingRef = useRef<EndName | null>(null)

  const sourceNode = nodesMap[source]
  const targetNode = nodesMap[target]
  if (!sourceNode || !targetNode) return null

  const sr = rectOf(nodesMap, sourceNode)
  const tr = rectOf(nodesMap, targetNode)

  const shape: EdgeShape = data?.shape ?? (data?.bend ? 'curved' : 'straight')

  // --- 端点の解決: ドラッグプレビュー > フリー座標 > アンカー > 自動（レガシー） ---
  const resolveEnd = (end: EndName, roughOther: Pt): EndPt => {
    const preview = dragEnd?.end === end ? dragEnd : null
    if (preview) {
      if (preview.kind === 'free') return { ...preview.p, side: null }
      const n = nodesMap[preview.nodeId]
      if (n) return anchorPoint(rectOf(nodesMap, n), preview.anchor)
    }
    const free = end === 'source' ? data?.sourceFree : data?.targetFree
    if (free) return { ...free, side: null }
    const anchor = end === 'source' ? data?.sourceAnchor : data?.targetAnchor
    const rect = end === 'source' ? sr : tr
    if (anchor) return anchorPoint(rect, anchor)
    return autoAttach(rect, roughOther)
  }
  const sRough: Pt = data?.sourceFree ?? (data?.sourceAnchor ? anchorPoint(sr, data.sourceAnchor) : { x: sr.cx, y: sr.cy })
  const tRough: Pt = data?.targetFree ?? (data?.targetAnchor ? anchorPoint(tr, data.targetAnchor) : { x: tr.cx, y: tr.cy })
  const sp = resolveEnd('source', tRough)
  const tp = resolveEnd('target', sRough)

  const sSide = sp.side ?? sideToward(sp, tp)
  const tSide = tp.side ?? sideToward(tp, sp)

  const bend = bendDraggingRef.current ? dragBend : (data?.bend ?? null)

  let path: string
  let labelPos: Pt = { x: (sp.x + tp.x) / 2, y: (sp.y + tp.y) / 2 }
  let curveHandle: Pt | null = null
  let elbowRuns: ElbowRun[] = []
  let elbowPts: Pt[] = []
  let curveM0: Pt = labelPos

  if (shape === 'curved') {
    // 両辺から垂直に出る3次ベジェ（初期はS字）。bend で両制御点を平行移動して曲げる
    const dist = Math.hypot(tp.x - sp.x, tp.y - sp.y)
    const k = Math.min(Math.max(dist * 0.4, 30), 160)
    const ns = SIDE_NORMAL[sSide]
    const nt = SIDE_NORMAL[tSide]
    let c1 = { x: sp.x + ns.x * k, y: sp.y + ns.y * k }
    let c2 = { x: tp.x + nt.x * k, y: tp.y + nt.y * k }
    curveM0 = { x: (sp.x + 3 * c1.x + 3 * c2.x + tp.x) / 8, y: (sp.y + 3 * c1.y + 3 * c2.y + tp.y) / 8 }
    if (bend) {
      // 制御点を bend*4/3 だけ動かすと曲線の中点がちょうど bend だけ動く
      c1 = { x: c1.x + bend.x * (4 / 3), y: c1.y + bend.y * (4 / 3) }
      c2 = { x: c2.x + bend.x * (4 / 3), y: c2.y + bend.y * (4 / 3) }
    }
    path = `M ${sp.x},${sp.y} C ${c1.x},${c1.y} ${c2.x},${c2.y} ${tp.x},${tp.y}`
    curveHandle = { x: curveM0.x + (bend?.x ?? 0), y: curveM0.y + (bend?.y ?? 0) }
    labelPos = curveHandle
  } else if (shape === 'elbow') {
    const exitIsH = sideIsH(sSide)
    // 保存済み coords はドラッグ中プレビューを優先。パリティ（終端への入射軸）が
    // 合わなくなったら破棄して自動ルーティングに戻す
    const storedCoords = dragElbow?.coords ?? data?.elbow?.coords ?? null
    const entryIsH = tp.side ? sideIsH(tSide) : null
    // 出発軸から coords 1個ごとに軸が交互に切り替わり、終端への入射軸は
    // 「exit と entry が同軸なら coords は奇数個 / 異軸なら偶数個」のとき整合する
    const parityOk =
      storedCoords != null &&
      (entryIsH == null || (storedCoords.length % 2 === 1) === (entryIsH === exitIsH))
    const coordsValid =
      Array.isArray(storedCoords) &&
      storedCoords.length > 0 &&
      storedCoords.every((v) => Number.isFinite(v)) &&
      parityOk

    if (coordsValid && storedCoords) {
      elbowPts = polylineFromCoords(sp, exitIsH, storedCoords, tp)
    } else {
      // 自動ルーティング: 外向きスタブ + ノード矩形の迂回。
      // 2ノードの隙間が狭いときは膨張量を隙間の半分にクランプし、
      // 膨張矩形同士の重なりによるマイクロ段差を防ぐ（隙間中央が単一の通り道になる）
      let mx = INFLATE
      let my = INFLATE
      if (sp.side && tp.side) {
        const gapX = Math.max(tr.x - (sr.x + sr.w), sr.x - (tr.x + tr.w))
        const gapY = Math.max(tr.y - (sr.y + sr.h), sr.y - (tr.y + tr.h))
        if (gapX > 0) mx = Math.min(INFLATE, gapX / 2)
        if (gapY > 0) my = Math.min(INFLATE, gapY / 2)
      }
      const obstacles: Rect[] = []
      if (sp.side) obstacles.push(inflateXY(sr, mx, my))
      if (tp.side) obstacles.push(inflateXY(tr, mx, my))
      const dirS = sp.side
        ? dirIndexOf(SIDE_NORMAL[sSide])
        : dirIndexOf(
            Math.abs(tp.x - sp.x) >= Math.abs(tp.y - sp.y)
              ? { x: tp.x - sp.x, y: 0 }
              : { x: 0, y: tp.y - sp.y },
          )
      const A: Pt = sp.side ? { x: sp.x + SIDE_NORMAL[sSide].x * STUB, y: sp.y + SIDE_NORMAL[sSide].y * STUB } : sp
      const B: Pt = tp.side ? { x: tp.x + SIDE_NORMAL[tSide].x * STUB, y: tp.y + SIDE_NORMAL[tSide].y * STUB } : tp
      const entryDir = tp.side ? dirIndexOf({ x: -SIDE_NORMAL[tSide].x, y: -SIDE_NORMAL[tSide].y }) : null
      const mid = autoRoute(A, dirS, B, entryDir, obstacles)
      elbowPts = cleanPolyline([sp, A, ...mid, B, tp])
    }
    path = roundedPath(elbowPts, 8)
    elbowRuns = runsFromPolyline(elbowPts)
    const midRun = elbowRuns[Math.floor((elbowRuns.length - 1) / 2)]
    if (midRun) labelPos = midRun.mid
  } else {
    path = `M ${sp.x},${sp.y} L ${tp.x},${tp.y}`
  }

  const pushHistory = (
    prev: { data?: Partial<BoardEdgeFlowData>; sourceNodeId?: string; targetNodeId?: string },
    next: { data?: Partial<BoardEdgeFlowData>; sourceNodeId?: string; targetNodeId?: string },
  ) => {
    useHistoryStore.getState().push({
      undo: () => updateEdge(id, prev),
      redo: () => updateEdge(id, next),
    })
  }

  const commitData = (patch: Partial<BoardEdgeFlowData>) => {
    const prev: Partial<BoardEdgeFlowData> = {}
    for (const key of Object.keys(patch)) prev[key] = data?.[key] ?? null
    void updateEdge(id, { data: patch })
    pushHistory({ data: prev }, { data: patch })
  }

  const capture = (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  const flowPos = (e: React.PointerEvent): Pt => screenToFlowPosition({ x: e.clientX, y: e.clientY })

  // --- 曲線の中央ハンドル ---
  const onBendPointerDown = (e: React.PointerEvent) => {
    capture(e)
    bendDraggingRef.current = true
    setDragBend(bend)
  }
  const onBendPointerMove = (e: React.PointerEvent) => {
    if (!bendDraggingRef.current) return
    const pos = flowPos(e)
    const next = { x: pos.x - curveM0.x, y: pos.y - curveM0.y }
    setDragBend(Math.hypot(next.x, next.y) < STRAIGHTEN_THRESHOLD ? null : next)
  }
  const onBendPointerUp = () => {
    if (!bendDraggingRef.current) return
    bendDraggingRef.current = false
    const prevBend = data?.bend ?? null
    const nextBend = dragBend
    setDragBend(null)
    if (JSON.stringify(prevBend) === JSON.stringify(nextBend)) return
    commitData({ bend: nextBend })
  }

  // --- 折れ線のセグメントハンドル: ドラッグ開始時に現在の経路を coords 化して編集する ---
  const onElbowPointerDown = (run: ElbowRun) => (e: React.PointerEvent) => {
    capture(e)
    elbowDraggingRef.current = run
    setDragElbow({ coords: coordsFromPolyline(elbowPts), index: run.coordIndex })
  }
  const onElbowPointerMove = (e: React.PointerEvent) => {
    const run = elbowDraggingRef.current
    if (!run || !dragElbow) return
    const pos = flowPos(e)
    const coords = [...dragElbow.coords]
    coords[dragElbow.index] = run.orient === 'v' ? pos.x : pos.y
    setDragElbow({ coords, index: dragElbow.index })
  }
  const onElbowPointerUp = () => {
    const run = elbowDraggingRef.current
    elbowDraggingRef.current = null
    if (!run || !dragElbow) return
    const coords = dragElbow.coords
    setDragElbow(null)
    const prevCoords = data?.elbow?.coords ?? null
    if (JSON.stringify(prevCoords) === JSON.stringify(coords)) return
    commitData({ elbow: { coords } })
  }

  // --- 端点ハンドル: 自由に動かし、ノードの縁に近づくと吸着する ---
  const snapCandidate = (p: Pt): { node: KNode; anchor: EdgeAnchor } | null => {
    if (!activeBoardId) return null
    // セクション（入れ子含む）の中の要素にも吸着できるよう再帰的に集める
    const candidates: KNode[] = []
    const collect = (parentId: string) => {
      for (const n of childrenOf(nodesMap, parentId)) {
        if (BOARD_ITEM_TYPES.includes(n.type)) candidates.push(n)
        if (n.type === 'section') collect(n.id)
      }
    }
    collect(activeBoardId)
    let best: { node: KNode; d: number } | null = null
    for (const n of candidates) {
      const d = distToRect(p, rectOf(nodesMap, n))
      if (d <= SNAP_DISTANCE && (!best || d < best.d)) best = { node: n, d }
    }
    if (!best) return null
    return { node: best.node, anchor: nearestPerimeterAnchor(rectOf(nodesMap, best.node), p) }
  }

  const onEndPointerDown = (end: EndName) => (e: React.PointerEvent) => {
    capture(e)
    endDraggingRef.current = end
  }
  const onEndPointerMove = (e: React.PointerEvent) => {
    const end = endDraggingRef.current
    if (!end) return
    const p = flowPos(e)
    const snap = snapCandidate(p)
    setDragEnd(
      snap
        ? { end, kind: 'anchor', nodeId: snap.node.id, anchor: snap.anchor }
        : { end, kind: 'free', p },
    )
  }
  const onEndPointerUp = () => {
    const end = endDraggingRef.current
    endDraggingRef.current = null
    if (!end || !dragEnd) return
    const preview = dragEnd
    setDragEnd(null)
    const isSource = end === 'source'
    const anchorKey = isSource ? 'sourceAnchor' : 'targetAnchor'
    const freeKey = isSource ? 'sourceFree' : 'targetFree'
    const nodeKey = isSource ? ('sourceNodeId' as const) : ('targetNodeId' as const)
    const prevNodeId = isSource ? source : target
    const prev = {
      data: { [anchorKey]: data?.[anchorKey] ?? null, [freeKey]: data?.[freeKey] ?? null },
      [nodeKey]: prevNodeId,
    }
    const next =
      preview.kind === 'free'
        ? { data: { [anchorKey]: null, [freeKey]: preview.p }, [nodeKey]: prevNodeId }
        : { data: { [anchorKey]: preview.anchor, [freeKey]: null }, [nodeKey]: preview.nodeId }
    void updateEdge(id, next)
    pushHistory(prev, next)
  }

  const color = data?.color ?? 'gray'
  const strokeWidth = data?.strokeWidth ?? 2

  const toolbarY = Math.min(sp.y, tp.y, ...elbowRuns.map((r) => r.mid.y), labelPos.y) - 16

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        {label ? (
          <div
            className="absolute rounded bg-white/90 px-1.5 py-0.5 text-[11px] text-neutral-700 shadow-sm"
            style={{ transform: `translate(-50%,-50%) translate(${labelPos.x}px,${labelPos.y}px)`, zIndex: 1100 }}
          >
            {label}
          </div>
        ) : null}
        {selected && (
          <>
            {/* 端点ハンドル: 自由移動 + ノード縁への吸着 */}
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
                onPointerDown={onEndPointerDown(end)}
                onPointerMove={onEndPointerMove}
                onPointerUp={onEndPointerUp}
              />
            ))}
            {/* 曲線: 中央ハンドル */}
            {curveHandle && (
              <div
                className="nodrag nopan absolute h-3 w-3 cursor-move rounded-full border-2 border-white bg-sky-500 shadow"
                style={{
                  transform: `translate(-50%,-50%) translate(${curveHandle.x}px,${curveHandle.y}px)`,
                  pointerEvents: 'all',
                  zIndex: 1100,
                }}
                onPointerDown={onBendPointerDown}
                onPointerMove={onBendPointerMove}
                onPointerUp={onBendPointerUp}
              />
            )}
            {/* 折れ線: 中間セグメントごとのピルハンドル */}
            {elbowRuns.map((run) => (
              <div
                key={run.coordIndex}
                className={cn(
                  'nodrag nopan absolute rounded-full bg-sky-500 shadow ring-1 ring-white',
                  run.orient === 'h' ? 'h-[6px] w-5 cursor-ns-resize' : 'h-5 w-[6px] cursor-ew-resize',
                )}
                style={{
                  transform: `translate(-50%,-50%) translate(${run.mid.x}px,${run.mid.y}px)`,
                  pointerEvents: 'all',
                  zIndex: 1100,
                }}
                onPointerDown={onElbowPointerDown(run)}
                onPointerMove={onElbowPointerMove}
                onPointerUp={onElbowPointerUp}
              />
            ))}
            {/* フローティングツールバー: 線種 / 色 / 太さ */}
            <div
              className="nodrag nopan absolute flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 shadow-md"
              style={{
                transform: `translate(-50%,-100%) translate(${(sp.x + tp.x) / 2}px,${toolbarY}px)`,
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
                      {opt.key === 'curved' && <path d="M2 13 C6 13 10 3 14 3" />}
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
