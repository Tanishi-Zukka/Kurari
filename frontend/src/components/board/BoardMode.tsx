import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  ConnectionMode,
  MarkerType,
  SelectionMode,
  useReactFlow,
  useNodesInitialized,
  type Node as FlowNode,
  type Edge as FlowEdge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { childrenOf, useEntityStore } from '@/stores/entity-store'
import { useUiStore } from '@/stores/ui-store'
import { useHistoryStore } from '@/stores/history-store'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  StickyNode,
  TextCardNode,
  ShapeNode,
  DrawingNode,
  ImageNode,
  SectionNode,
  stickyNameFrom,
  STROKE_COLORS,
  STICKY_FILL,
  SHAPE_CLASSES,
  SECTION_STYLES,
} from './BoardNodes'
import { BoardEdge } from './BoardEdge'
import { BoardToolbar, type NewItemKind, type BoardTool } from './BoardToolbar'
import { BoardZoomControl } from './BoardZoomControl'
import { BoardSyncBadge } from './BoardSyncBadge'
import {
  stickyData,
  drawingData,
  imageData,
  absoluteXY,
  BOARD_ITEM_TYPES,
  type StickyColor,
  type NodeType,
  type KNode,
  type KEdge,
  type EdgeData,
  type EdgeSide,
} from '@/types/model'

const nodeTypes = {
  sticky: StickyNode,
  text_card: TextCardNode,
  shape: ShapeNode,
  drawing: DrawingNode,
  image: ImageNode,
  section: SectionNode,
}

const edgeTypes = {
  board: BoardEdge,
}

/** 種別ごとの新規作成時デフォルト。付箋は FigJam と同じく正方形 */
const ITEM_DEFAULTS: Record<string, { w: number; h: number; data: Record<string, unknown> }> = {
  sticky: { w: 180, h: 180, data: {} },
  text_card: { w: 240, h: 60, data: {} },
  rect: { w: 180, h: 100, data: { kind: 'rect' } },
  ellipse: { w: 160, h: 110, data: { kind: 'ellipse' } },
  section: { w: 600, h: 400, data: {} },
}

/** 画像配置時の最大辺。原寸の縦横比を保ったままこのサイズに収める */
const IMAGE_MAX_DIMENSION = 480
const IMAGE_FALLBACK_W = 320
const IMAGE_FALLBACK_H = 220

/** 配置モード中にカーソルへ追従する半透明プレビュー（FigJam 風） */
function PlaceGhost({
  kind,
  color,
  pos,
  zoom,
}: {
  kind: NewItemKind
  color: StickyColor
  pos: { x: number; y: number }
  zoom: number
}) {
  const def = ITEM_DEFAULTS[kind]
  const style: React.CSSProperties = {
    left: pos.x,
    top: pos.y,
    width: def.w * zoom,
    height: def.h * zoom,
    transform: 'translate(-50%,-50%)',
  }
  if (kind === 'text_card') {
    return (
      <div className="pointer-events-none absolute flex items-center opacity-60" style={style}>
        <span className="whitespace-nowrap text-neutral-400" style={{ fontSize: 15 * zoom }}>
          テキストを追加
        </span>
      </div>
    )
  }
  if (kind === 'section') {
    return (
      <div
        className="pointer-events-none absolute rounded-lg border-2 border-neutral-400 bg-neutral-400/10 opacity-60"
        style={style}
      />
    )
  }
  return (
    <div
      className={cn(
        'pointer-events-none absolute opacity-50',
        kind === 'sticky'
          ? cn(STICKY_FILL[color], 'rounded-[2px] shadow-md')
          : cn(SHAPE_CLASSES[color], 'border-2', kind === 'ellipse' ? 'rounded-full' : 'rounded-sm'),
      )}
      style={style}
    />
  )
}

/** アップロード前にブラウザで原寸を読み取る。読めない形式は null */
async function readImageSize(file: File): Promise<{ w: number; h: number } | null> {
  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
      img.onerror = () => resolve(null)
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
}

function BoardCanvas() {
  const nodes = useEntityStore((s) => s.nodes)
  const edges = useEntityStore((s) => s.edges)
  const updateNode = useEntityStore((s) => s.updateNode)
  const removeNode = useEntityStore((s) => s.removeNode)
  const restoreNode = useEntityStore((s) => s.restoreNode)
  const createNode = useEntityStore((s) => s.createNode)
  const createEdge = useEntityStore((s) => s.createEdge)
  const removeEdge = useEntityStore((s) => s.removeEdge)
  const restoreEdge = useEntityStore((s) => s.restoreEdge)

  const activeBoardId = useUiStore((s) => s.activeBoardId)
  const selectedIds = useUiStore((s) => s.selectedIds)
  const setSelected = useUiStore((s) => s.setSelected)
  const panRequestId = useUiStore((s) => s.panRequestId)
  const clearPanRequest = useUiStore((s) => s.clearPanRequest)

  const { setCenter, screenToFlowPosition, getZoom, getInternalNode, fitView } = useReactFlow()
  const nodesInitialized = useNodesInitialized()

  const [activeTool, setActiveTool] = useState<BoardTool>('select')
  const [color, setColor] = useState<StickyColor>('yellow')
  const [translucent, setTranslucent] = useState(false)
  // エッジの選択状態。controlled 運用のため自前で保持する（曲げハンドルの表示に使う）
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([])
  // 配置モード: ツールを選んでからカーソルで配置場所を決める（FigJam 風）
  const [placing, setPlacing] = useState<NewItemKind | null>(null)
  const [placePos, setPlacePos] = useState<{ x: number; y: number } | null>(null)
  // セクション作成用: 2点ドラッグ中の矩形（wrapper 基準のスクリーン座標）
  const [drawRect, setDrawRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const drawStartFlowRef = useRef<{ x: number; y: number } | null>(null)

  const wrapperRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragStartRef = useRef<Record<string, { x: number; y: number }>>({})

  // ペン描画用: 永続化には flow 座標、プレビュー描画には wrapper 基準のスクリーン座標を使う
  const penFlowPointsRef = useRef<{ x: number; y: number }[]>([])
  const penPendingScreenRef = useRef<{ x: number; y: number }[]>([])
  const penRafRef = useRef<number | null>(null)
  const [penPreview, setPenPreview] = useState<{ x: number; y: number }[]>([])

  // ボード切替時は undo/redo 履歴をクリアする（別ボードの操作を巻き戻さないため）
  useEffect(() => {
    useHistoryStore.getState().clear()
  }, [activeBoardId])

  // 初期表示フィット。fitView プロパティは使わない:
  // ジャンプ（パン要求つきマウント）のとき、fitView の遅延解決が setCenter を上書きしてしまうため、
  // パン要求が無いときだけ自前でフィットする
  const fitDoneRef = useRef<string | null>(null)
  useEffect(() => {
    if (!activeBoardId || !nodesInitialized) return
    if (fitDoneRef.current === activeBoardId) return
    fitDoneRef.current = activeBoardId
    if (useUiStore.getState().panRequestId) return
    void fitView({ padding: 0.2, maxZoom: 1 })
  }, [activeBoardId, nodesInitialized, fitView])

  // ストア → React Flow ノード（controlled）
  // measured を明示的に渡す: controlled 運用では dimensions 変更を書き戻さない限り
  // React Flow の nodesInitialized が true にならず、パン等が永久に無効化されるため。
  // 寸法は自前管理（w/h）なのでそのまま渡してよい。
  const flowNodes: FlowNode[] = useMemo(() => {
    if (!activeBoardId) return []
    const itemToFlow = (n: KNode, parentSectionId?: string): FlowNode => {
      // セクション配下は座標がセクション相対。React Flow の parentId で親子にする
      const parent = parentSectionId ? { parentId: parentSectionId } : {}
      if (n.type === 'drawing') {
        const d = drawingData(n)
        return {
          id: n.id,
          type: n.type,
          position: { x: d.x, y: d.y },
          data: { points: d.points, color: d.color, strokeWidth: d.strokeWidth },
          selected: selectedIds.includes(n.id),
          width: d.w,
          height: d.h,
          measured: { width: d.w, height: d.h },
          ...parent,
        }
      }
      if (n.type === 'image') {
        const d = imageData(n)
        return {
          id: n.id,
          type: n.type,
          position: { x: d.x, y: d.y },
          data: { url: d.url },
          selected: selectedIds.includes(n.id),
          width: d.w,
          height: d.h,
          measured: { width: d.w, height: d.h },
          ...parent,
        }
      }
      const d = stickyData(n)
      return {
        id: n.id,
        type: n.type,
        position: { x: d.x, y: d.y },
        data: { text: d.text, color: d.color, translucent: d.translucent, kind: d.kind },
        selected: selectedIds.includes(n.id),
        width: d.w,
        height: d.h,
        measured: { width: d.w, height: d.h },
        ...parent,
      }
    }
    const result: FlowNode[] = []
    // セクションの入れ子を再帰的に展開する。React Flow は親ノードが配列上で子より先に必要。
    // zIndex: -10000 はセクションを常に全要素の背面に置くため
    // （選択時の +1000 を足しても負のままなので、選択中も要素の下に潜ったまま）。
    // 子の z は max(親z+1, 自身のz) なので、セクション内の要素は通常どおり手前に描かれる。
    const walk = (parentId: string, parentSectionId?: string) => {
      for (const n of childrenOf(nodes, parentId)) {
        if (n.type === 'section') {
          const d = n.data as {
            x?: number
            y?: number
            w?: number
            h?: number
            color?: StickyColor
            translucent?: boolean
          }
          const w = d.w ?? 600
          const h = d.h ?? 400
          result.push({
            id: n.id,
            type: 'section',
            position: { x: d.x ?? 0, y: d.y ?? 0 },
            data: { title: n.name, color: d.color ?? 'gray', translucent: d.translucent ?? false },
            selected: selectedIds.includes(n.id),
            width: w,
            height: h,
            measured: { width: w, height: h },
            zIndex: -10000,
            ...(parentSectionId ? { parentId: parentSectionId } : {}),
          })
          walk(n.id, n.id)
        } else if (BOARD_ITEM_TYPES.includes(n.type)) {
          result.push(itemToFlow(n, parentSectionId))
        }
      }
    }
    walk(activeBoardId)
    return result
  }, [nodes, activeBoardId, selectedIds])

  // ストア → React Flow エッジ
  const flowEdges: FlowEdge[] = useMemo(() => {
    if (!activeBoardId) return []
    return Object.values(edges)
      .filter((e) => e.boardId === activeBoardId)
      .map((e) => {
        const d: EdgeData = e.data ?? {}
        const stroke = STROKE_COLORS[d.color ?? 'gray'] ?? STROKE_COLORS.gray
        return {
          id: e.id,
          type: 'board',
          source: e.sourceNodeId,
          target: e.targetNodeId,
          label: e.label || undefined,
          data: { ...d },
          selected: selectedEdgeIds.includes(e.id),
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: stroke },
          style: { stroke, strokeWidth: d.strokeWidth ?? 2 },
        }
      })
  }, [edges, activeBoardId, selectedEdgeIds])

  // ツリー側からのパン要求。
  // React Flow の初期化（ノード計測）が済む前に setCenter を呼ぶと
  // 内部ストアが無限再レンダリングに陥るため、nodesInitialized を待つ。
  useEffect(() => {
    if (!panRequestId || !nodesInitialized) return
    const target = nodes[panRequestId]
    if (target && (BOARD_ITEM_TYPES.includes(target.type) || target.type === 'section')) {
      const d = stickyData(target)
      const abs = absoluteXY(nodes, target) // セクション配下は相対座標のため絶対に変換
      setCenter(abs.x + d.w / 2, abs.y + d.h / 2, { zoom: 1.1, duration: 400 })
    }
    clearPanRequest()
  }, [panRequestId, nodesInitialized, nodes, setCenter, clearPanRequest])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // controlled運用: ユーザー操作由来の変更のみストアへ反映する。
      // マウント/レイアウト時の position イベントや、内部リコンサイルの選択イベントを
      // 書き戻すと store→ReactFlow→store の無限ループになるため扱わない。
      // （選択は onSelectionChange ではなく、ここの 'select' 変更だけで同期する）

      // 1) ドラッグ中の位置をライブ反映（永続化はドラッグ終了時の onNodeDragStop）
      const dragChanges = changes.filter(
        (c): c is Extract<NodeChange, { type: 'position' }> =>
          c.type === 'position' && !!c.position && c.dragging === true,
      )
      if (dragChanges.length > 0) {
        useEntityStore.setState((s) => {
          const next = { ...s.nodes }
          for (const c of dragChanges) {
            const n = next[c.id]
            if (n) next[c.id] = { ...n, data: { ...n.data, x: c.position!.x, y: c.position!.y } }
          }
          return { nodes: next }
        })
      }

      // 2) リサイズ中のサイズをライブ反映（永続化はリサイズ終了時の onResizeEnd）
      const dimChanges = changes.filter(
        (c): c is Extract<NodeChange, { type: 'dimensions' }> =>
          c.type === 'dimensions' && !!c.dimensions && c.resizing === true,
      )
      if (dimChanges.length > 0) {
        useEntityStore.setState((s) => {
          const next = { ...s.nodes }
          for (const c of dimChanges) {
            const n = next[c.id]
            if (n)
              next[c.id] = {
                ...n,
                data: { ...n.data, w: c.dimensions!.width, h: c.dimensions!.height },
              }
          }
          return { nodes: next }
        })
      }

      // 3) ユーザーのクリック・範囲選択による選択変更
      const selectChanges = changes.filter(
        (c): c is Extract<NodeChange, { type: 'select' }> => c.type === 'select',
      )
      if (selectChanges.length > 0) {
        const current = useUiStore.getState().selectedIds
        const next = new Set(current)
        for (const c of selectChanges) {
          if (c.selected) next.add(c.id)
          else next.delete(c.id)
        }
        const snapshot = useEntityStore.getState().nodes
        // ツリー選択由来のボード等（RFノードでないID）が残っていると、下の祖先チェックで
        // 選択した要素が全部除外されてしまうため、先にボード要素以外を落とす
        for (const id of [...next]) {
          const n = snapshot[id]
          if (n && !BOARD_ITEM_TYPES.includes(n.type) && n.type !== 'section') next.delete(id)
        }
        // セクションとその中身（入れ子の孫を含む）が同時に選択されたら中身を外す。
        // 両方選択のままドラッグすると、中身が親の移動+自身の移動で二重に動いてしまうため
        for (const id of [...next]) {
          let p = snapshot[id]?.parentId
          while (p) {
            if (next.has(p)) {
              next.delete(id)
              break
            }
            p = snapshot[p]?.parentId
          }
        }
        const nextIds = [...next]
        const same =
          nextIds.length === current.length && nextIds.every((id) => current.includes(id))
        if (!same) setSelected(nextIds)
      }
    },
    [setSelected],
  )

  // エッジは選択変更のみ扱う（削除は onDelete、形状は BoardEdge が担う）
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const selectChanges = changes.filter(
      (c): c is Extract<EdgeChange, { type: 'select' }> => c.type === 'select',
    )
    if (selectChanges.length === 0) return
    setSelectedEdgeIds((current) => {
      const next = new Set(current)
      for (const c of selectChanges) {
        if (c.selected) next.add(c.id)
        else next.delete(c.id)
      }
      return [...next]
    })
  }, [])

  const onNodeDragStart = useCallback((_e: unknown, node: FlowNode, draggedNodes?: FlowNode[]) => {
    for (const n of draggedNodes?.length ? draggedNodes : [node]) {
      dragStartRef.current[n.id] = { x: n.position.x, y: n.position.y }
    }
  }, [])

  /**
   * 絶対座標 p を含む最も深い（入れ子の内側の）セクションを返す。
   * excludeId を指定すると、そのセクション自身と子孫を候補から外す
   * （セクション自体をドラッグして別セクションへ入れるとき、自分の中に入れないため）。
   */
  const sectionAt = useCallback(
    (p: { x: number; y: number }, excludeId?: string): KNode | null => {
      if (!activeBoardId) return null
      const snapshot = useEntityStore.getState().nodes
      let best: { node: KNode; depth: number } | null = null
      const walk = (parentId: string, depth: number, excluded: boolean) => {
        for (const n of childrenOf(snapshot, parentId)) {
          if (n.type !== 'section') continue
          const ex = excluded || n.id === excludeId
          const o = absoluteXY(snapshot, n)
          const d = n.data as { w?: number; h?: number }
          const inside = p.x >= o.x && p.x <= o.x + (d.w ?? 0) && p.y >= o.y && p.y <= o.y + (d.h ?? 0)
          if (inside && !ex && (!best || depth > best.depth)) best = { node: n, depth }
          walk(n.id, depth + 1, ex)
        }
      }
      walk(activeBoardId, 0, false)
      return best?.node ?? null
    },
    [activeBoardId],
  )

  /** ドラッグ終了時の永続化。複数選択の一括移動にも対応し、undo/redo は1操作にまとめる */
  const persistDraggedNodes = useCallback(
    (draggedNodes: FlowNode[]) => {
      const snapshot = useEntityStore.getState().nodes
      const ops: { undo: () => void; redo: () => void }[] = []
      for (const node of draggedNodes) {
        const start = dragStartRef.current[node.id]
        delete dragStartRef.current[node.id]
        const end = { x: node.position.x, y: node.position.y }
        const kn = snapshot[node.id]
        if (!kn) continue
        const moved = !start || start.x !== end.x || start.y !== end.y

        // ボード要素・セクションは、ドロップ位置（中心の絶対座標）でセクション所属を判定して付け替える。
        // セクション自身の場合は、自分と子孫を候補から除外する（自分の中に入る循環を防ぐ）
        if (activeBoardId && (BOARD_ITEM_TYPES.includes(kn.type) || kn.type === 'section')) {
          const abs = getInternalNode(node.id)?.internals.positionAbsolute ?? end
          const d = kn.data as { w?: number; h?: number }
          const center = { x: abs.x + (d.w ?? 0) / 2, y: abs.y + (d.h ?? 0) / 2 }
          const sec = sectionAt(center, kn.type === 'section' ? kn.id : undefined)
          const newParentId = sec?.id ?? activeBoardId
          const prevParentId = kn.parentId ?? activeBoardId
          if (newParentId !== prevParentId) {
            const origin = sec ? absoluteXY(snapshot, sec) : { x: 0, y: 0 }
            const rel = { x: abs.x - origin.x, y: abs.y - origin.y }
            void updateNode(node.id, { parentId: newParentId, data: rel })
            ops.push({
              undo: () => void updateNode(node.id, { parentId: prevParentId, data: start ?? end }),
              redo: () => void updateNode(node.id, { parentId: newParentId, data: rel }),
            })
            continue
          }
        }

        void updateNode(node.id, { data: end })
        if (moved && start) {
          ops.push({
            undo: () => void updateNode(node.id, { data: start }),
            redo: () => void updateNode(node.id, { data: end }),
          })
        }
      }
      if (ops.length > 0) {
        useHistoryStore.getState().push({
          undo: () => {
            for (const op of ops) op.undo()
          },
          redo: () => {
            for (const op of ops) op.redo()
          },
        })
      }
    },
    [updateNode, activeBoardId, sectionAt, getInternalNode],
  )

  const onNodeDragStop = useCallback(
    (_e: unknown, node: FlowNode, draggedNodes?: FlowNode[]) => {
      persistDraggedNodes(draggedNodes?.length ? draggedNodes : [node])
    },
    [persistDraggedNodes],
  )

  // 範囲選択ボックスごとドラッグしたときは onSelectionDrag* に来る
  const onSelectionDragStart = useCallback((_e: unknown, draggedNodes: FlowNode[]) => {
    for (const n of draggedNodes) {
      dragStartRef.current[n.id] = { x: n.position.x, y: n.position.y }
    }
  }, [])

  const onSelectionDragStop = useCallback(
    (_e: unknown, draggedNodes: FlowNode[]) => {
      persistDraggedNodes(draggedNodes)
    },
    [persistDraggedNodes],
  )

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!activeBoardId || !conn.source || !conn.target || conn.source === conn.target) return
      const source = conn.source
      const target = conn.target
      // FigJam 風: 接続時に選んだハンドルの辺の中央をアンカーとして固定する
      const isSide = (v: string | null | undefined): v is EdgeSide =>
        v === 't' || v === 'r' || v === 'b' || v === 'l'
      const data: EdgeData = {
        shape: 'elbow',
        sourceAnchor: isSide(conn.sourceHandle) ? { side: conn.sourceHandle, t: 0.5 } : null,
        targetAnchor: isSide(conn.targetHandle) ? { side: conn.targetHandle, t: 0.5 } : null,
      }
      void (async () => {
        const edge = await createEdge({ boardId: activeBoardId, sourceNodeId: source, targetNodeId: target, data })
        useHistoryStore.getState().push({
          undo: () => removeEdge(edge.id),
          redo: () => restoreEdge(edge),
        })
      })()
    },
    [activeBoardId, createEdge, removeEdge, restoreEdge],
  )

  /** 絶対座標の矩形でセクションを作成する（2点ドラッグ・デフォルト配置の共通処理） */
  const createSectionAt = useCallback(
    async (rect: { x: number; y: number; w: number; h: number }) => {
      if (!activeBoardId) return
      // 配置先が別セクションの中なら入れ子セクションとして作る（矩形の中心で判定）
      const snapshot0 = useEntityStore.getState().nodes
      const parentSec = sectionAt({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 })
      const parentOrigin = parentSec ? absoluteXY(snapshot0, parentSec) : { x: 0, y: 0 }
      const parentId = parentSec?.id ?? activeBoardId
      const x = rect.x - parentOrigin.x // 親ローカル座標
      const y = rect.y - parentOrigin.y
      const node = await createNode({
        parentId,
        type: 'section',
        name: 'セクション',
        data: { x, y, w: rect.w, h: rect.h, color, translucent },
      })
      // FigJam 同様、配置した領域に既にある要素（同じ親の直下）はセクション配下に取り込む。
      // 兄弟同士は同じ座標系なので親ローカル座標のまま比較できる
      const snapshot = useEntityStore.getState().nodes
      const captured: { id: string; prev: { x: number; y: number } }[] = []
      for (const n of childrenOf(snapshot, parentId)) {
        if (!BOARD_ITEM_TYPES.includes(n.type)) continue
        const d = n.data as { x?: number; y?: number; w?: number; h?: number }
        const cx = (d.x ?? 0) + (d.w ?? 0) / 2
        const cy = (d.y ?? 0) + (d.h ?? 0) / 2
        if (cx >= x && cx <= x + rect.w && cy >= y && cy <= y + rect.h) {
          captured.push({ id: n.id, prev: { x: d.x ?? 0, y: d.y ?? 0 } })
          void updateNode(n.id, { parentId: node.id, data: { x: (d.x ?? 0) - x, y: (d.y ?? 0) - y } })
        }
      }
      setSelected([node.id])
      useHistoryStore.getState().push({
        undo: async () => {
          // 取り込んだ要素を先に元の親へ戻してからセクションを消す（カスケード削除を避ける）
          for (const c of captured) await updateNode(c.id, { parentId, data: c.prev })
          await removeNode(node.id)
        },
        redo: async () => {
          await restoreNode(node)
          for (const c of captured) {
            await updateNode(c.id, { parentId: node.id, data: { x: c.prev.x - x, y: c.prev.y - y } })
          }
        },
      })
    },
    [activeBoardId, createNode, setSelected, removeNode, restoreNode, sectionAt, updateNode, color, translucent],
  )

  const createItem = useCallback(
    async (kind: NewItemKind, pos: { x: number; y: number }, itemColor: StickyColor) => {
      if (!activeBoardId) return
      const def = ITEM_DEFAULTS[kind]
      if (kind === 'section') {
        await createSectionAt({ x: pos.x - def.w / 2, y: pos.y - def.h / 2, w: def.w, h: def.h })
        return
      }
      // 配置位置がセクション内なら、ツリー上もそのセクション（入れ子なら最深）の子として作る
      const snapshotI = useEntityStore.getState().nodes
      const sec = sectionAt(pos)
      const origin = sec ? absoluteXY(snapshotI, sec) : { x: 0, y: 0 }
      const type: NodeType = kind === 'rect' || kind === 'ellipse' ? 'shape' : kind
      const node = await createNode({
        parentId: sec?.id ?? activeBoardId,
        type,
        name: stickyNameFrom(''),
        data: {
          text: '',
          color: itemColor,
          translucent,
          x: pos.x - def.w / 2 - origin.x,
          y: pos.y - def.h / 2 - origin.y,
          w: def.w,
          h: def.h,
          ...def.data,
        },
      })
      setSelected([node.id])
      useHistoryStore.getState().push({ undo: () => removeNode(node.id), redo: () => restoreNode(node) })
    },
    [activeBoardId, createNode, setSelected, removeNode, restoreNode, sectionAt, createSectionAt, translucent],
  )

  const viewportCenterFlowPos = useCallback(() => {
    const rect = wrapperRef.current?.getBoundingClientRect()
    const center = rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    return screenToFlowPosition(center)
  }, [screenToFlowPosition])

  const handleImageFile = useCallback(
    async (file: File, pos: { x: number; y: number }) => {
      if (!activeBoardId) return
      try {
        // 原寸の縦横比を保ったまま最大辺 IMAGE_MAX_DIMENSION に収める（FigJam と同じ挙動）
        const size = await readImageSize(file)
        let w = IMAGE_FALLBACK_W
        let h = IMAGE_FALLBACK_H
        if (size && size.w > 0 && size.h > 0) {
          const scale = Math.min(1, IMAGE_MAX_DIMENSION / Math.max(size.w, size.h))
          w = Math.max(Math.round(size.w * scale), 20)
          h = Math.max(Math.round(size.h * scale), 20)
        }
        const { url } = await api.uploadFile(file)
        const sec = sectionAt(pos)
        const origin = sec ? absoluteXY(useEntityStore.getState().nodes, sec) : { x: 0, y: 0 }
        const node = await createNode({
          parentId: sec?.id ?? activeBoardId,
          type: 'image',
          name: '(image)',
          data: {
            url,
            x: pos.x - w / 2 - origin.x,
            y: pos.y - h / 2 - origin.y,
            w,
            h,
          },
        })
        setSelected([node.id])
        useHistoryStore.getState().push({ undo: () => removeNode(node.id), redo: () => restoreNode(node) })
      } catch (e) {
        console.error('image upload failed', e)
      }
    },
    [activeBoardId, createNode, setSelected, removeNode, restoreNode, sectionAt],
  )

  // クリップボード貼り付けで画像を追加
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (!activeBoardId) return
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) void handleImageFile(file, viewportCenterFlowPos())
          break
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [activeBoardId, handleImageFile, viewportCenterFlowPos])

  // Undo/Redo キーボードショートカット、ペンモード中は Escape で選択モードに戻す
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && placing) {
        setPlacing(null)
        setPlacePos(null)
        return
      }
      if (e.key === 'Escape' && activeTool === 'pen') {
        setActiveTool('select')
        return
      }
      if (isEditableTarget(e.target)) return
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const key = e.key.toLowerCase()
      if (key === 'z') {
        e.preventDefault()
        if (e.shiftKey) void useHistoryStore.getState().redo()
        else void useHistoryStore.getState().undo()
      } else if (key === 'y') {
        e.preventDefault()
        void useHistoryStore.getState().redo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeTool, placing])

  const onPaneDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      void createItem('sticky', pos, 'yellow')
    },
    [screenToFlowPosition, createItem],
  )

  const onDelete = useCallback(
    ({ nodes: delNodes, edges: delEdges }: { nodes: FlowNode[]; edges: FlowEdge[] }) => {
      const state = useEntityStore.getState()
      // 子孫（セクションの中身・コメント等）もスナップショットし、undo で丸ごと復元できるようにする
      const seen = new Set<string>()
      const nodeSnapshots: KNode[] = []
      const collect = (id: string) => {
        const n = state.nodes[id]
        if (!n || seen.has(id)) return
        seen.add(id)
        nodeSnapshots.push(n)
        for (const c of childrenOf(state.nodes, id)) collect(c.id)
      }
      for (const n of delNodes) collect(n.id)
      const edgeSnapshots = delEdges.map((e) => state.edges[e.id]).filter((e): e is KEdge => !!e)
      if (nodeSnapshots.length === 0 && edgeSnapshots.length === 0) return
      for (const n of delNodes) void removeNode(n.id)
      for (const e of edgeSnapshots) void removeEdge(e.id)
      useHistoryStore.getState().push({
        undo: () => {
          for (const n of nodeSnapshots) void restoreNode(n)
          for (const e of edgeSnapshots) void restoreEdge(e)
        },
        redo: () => {
          for (const n of nodeSnapshots) void removeNode(n.id)
          for (const e of edgeSnapshots) void removeEdge(e.id)
        },
      })
    },
    [removeNode, removeEdge, restoreNode, restoreEdge],
  )

  const recolorSelected = useCallback(
    (nextColor: StickyColor, nextTranslucent: boolean) => {
      const snapshot = useEntityStore.getState().nodes
      const targets = selectedIds
        .map((id) => snapshot[id])
        .filter(
          (n): n is KNode => !!n && (n.type === 'sticky' || n.type === 'shape' || n.type === 'section'),
        )
      if (targets.length === 0) return
      const prev = new Map(
        targets.map((n) => {
          const d = n.data as { color?: StickyColor; translucent?: boolean }
          return [
            n.id,
            {
              color: d.color ?? (n.type === 'section' ? ('gray' as StickyColor) : ('yellow' as StickyColor)),
              translucent: d.translucent ?? false,
            },
          ]
        }),
      )
      for (const n of targets) void updateNode(n.id, { data: { color: nextColor, translucent: nextTranslucent } })
      useHistoryStore.getState().push({
        undo: () => {
          for (const n of targets) {
            const p = prev.get(n.id)
            void updateNode(n.id, { data: { color: p?.color ?? 'yellow', translucent: p?.translucent ?? false } })
          }
        },
        redo: () => {
          for (const n of targets) void updateNode(n.id, { data: { color: nextColor, translucent: nextTranslucent } })
        },
      })
    },
    [selectedIds, updateNode],
  )

  // --- ペンツール: ポインタ操作でフリーハンド描画し、離した時点でノード化する ---
  const onPenPointerDown = useCallback(
    (e: React.PointerEvent) => {
      ;(e.target as Element).setPointerCapture(e.pointerId)
      const rect = wrapperRef.current?.getBoundingClientRect()
      const local = rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : { x: e.clientX, y: e.clientY }
      penFlowPointsRef.current = [screenToFlowPosition({ x: e.clientX, y: e.clientY })]
      penPendingScreenRef.current = [local]
      setPenPreview([local])
    },
    [screenToFlowPosition],
  )

  const onPenPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (penFlowPointsRef.current.length === 0) return
      const rect = wrapperRef.current?.getBoundingClientRect()
      const local = rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : { x: e.clientX, y: e.clientY }
      penFlowPointsRef.current.push(screenToFlowPosition({ x: e.clientX, y: e.clientY }))
      penPendingScreenRef.current.push(local)
      if (penRafRef.current == null) {
        penRafRef.current = requestAnimationFrame(() => {
          setPenPreview([...penPendingScreenRef.current])
          penRafRef.current = null
        })
      }
    },
    [screenToFlowPosition],
  )

  const onPenPointerUp = useCallback(async () => {
    const pts = penFlowPointsRef.current
    penFlowPointsRef.current = []
    penPendingScreenRef.current = []
    setPenPreview([])
    if (!activeBoardId || pts.length < 2) return
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const maxX = Math.max(...xs)
    const maxY = Math.max(...ys)
    const w = Math.max(maxX - minX, 1)
    const h = Math.max(maxY - minY, 1)
    const rel = pts.map((p) => ({ x: p.x - minX, y: p.y - minY }))
    const node = await createNode({
      parentId: activeBoardId,
      type: 'drawing',
      name: '(drawing)',
      data: { points: rel, color, strokeWidth: 2, x: minX, y: minY, w, h },
    })
    useHistoryStore.getState().push({ undo: () => removeNode(node.id), redo: () => restoreNode(node) })
  }, [activeBoardId, createNode, color, removeNode, restoreNode])

  const penPreviewPath =
    penPreview.length > 1
      ? `M ${penPreview[0].x} ${penPreview[0].y} ` +
        penPreview
          .slice(1)
          .map((p) => `L ${p.x} ${p.y}`)
          .join(' ')
      : ''

  if (!activeBoardId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-400">
        左のツリーからボードを選択してください
      </div>
    )
  }

  const isPen = activeTool === 'pen'

  return (
    <div
      ref={wrapperRef}
      className="relative h-full w-full"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'))
        if (file) void handleImageFile(file, screenToFlowPosition({ x: e.clientX, y: e.clientY }))
      }}
    >
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onSelectionDragStart={onSelectionDragStart}
        onSelectionDragStop={onSelectionDragStop}
        onDelete={onDelete}
        onConnect={onConnect}
        onDoubleClick={onPaneDoubleClick}
        connectionMode={ConnectionMode.Loose}
        defaultEdgeOptions={{
          markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
          style: { strokeWidth: 1.8 },
        }}
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: false }}
        deleteKeyCode={['Backspace', 'Delete']}
        // FigJam 風: 左ドラッグは範囲選択、パンはホイールスクロール / 中・右ボタンドラッグ
        panOnDrag={isPen ? false : [1, 2]}
        panOnScroll
        selectionOnDrag={!isPen}
        selectionMode={SelectionMode.Partial}
        nodesDraggable={!isPen}
        elementsSelectable={!isPen}
      >
        <Background gap={20} size={1.5} />
      </ReactFlow>
      {placing && (
        <div
          data-testid="place-overlay"
          className={cn('absolute inset-0 z-[5]', placing === 'section' && 'cursor-crosshair')}
          onPointerMove={(e) => {
            const rect = wrapperRef.current?.getBoundingClientRect()
            const local = rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : null
            setPlacePos(local)
            if (placing === 'section' && drawStartFlowRef.current && local) {
              setDrawRect((r) => (r ? { ...r, x1: local.x, y1: local.y } : r))
            }
          }}
          onPointerLeave={() => setPlacePos(null)}
          onPointerDown={
            placing === 'section'
              ? (e) => {
                  ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
                  const rect = wrapperRef.current?.getBoundingClientRect()
                  const local = rect
                    ? { x: e.clientX - rect.left, y: e.clientY - rect.top }
                    : { x: e.clientX, y: e.clientY }
                  drawStartFlowRef.current = screenToFlowPosition({ x: e.clientX, y: e.clientY })
                  setDrawRect({ x0: local.x, y0: local.y, x1: local.x, y1: local.y })
                }
              : undefined
          }
          onPointerUp={
            placing === 'section'
              ? (e) => {
                  const start = drawStartFlowRef.current
                  drawStartFlowRef.current = null
                  setDrawRect(null)
                  if (!start) return
                  const end = screenToFlowPosition({ x: e.clientX, y: e.clientY })
                  const w = Math.abs(end.x - start.x)
                  const h = Math.abs(end.y - start.y)
                  setPlacing(null)
                  setPlacePos(null)
                  if (w < 24 || h < 24) {
                    // ほぼクリック: デフォルトサイズで配置
                    void createItem('section', end, color)
                  } else {
                    void createSectionAt({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), w, h })
                  }
                }
              : undefined
          }
          onClick={
            placing === 'section'
              ? undefined
              : (e) => {
                  const kind = placing
                  setPlacing(null)
                  setPlacePos(null)
                  void createItem(kind, screenToFlowPosition({ x: e.clientX, y: e.clientY }), color)
                }
          }
        >
          {placing !== 'section' && placePos && (
            <PlaceGhost kind={placing} color={color} pos={placePos} zoom={getZoom()} />
          )}
          {placing === 'section' && drawRect && (
            <div
              className={cn(
                'pointer-events-none absolute rounded-lg border-2',
                (SECTION_STYLES[color] ?? SECTION_STYLES.gray).frame,
              )}
              style={{
                left: Math.min(drawRect.x0, drawRect.x1),
                top: Math.min(drawRect.y0, drawRect.y1),
                width: Math.abs(drawRect.x1 - drawRect.x0),
                height: Math.abs(drawRect.y1 - drawRect.y0),
              }}
            />
          )}
        </div>
      )}
      {isPen && (
        <div
          className="absolute inset-0 z-[5] cursor-crosshair"
          onPointerDown={onPenPointerDown}
          onPointerMove={onPenPointerMove}
          onPointerUp={() => void onPenPointerUp()}
        >
          <svg className="pointer-events-none h-full w-full">
            {penPreviewPath && (
              <path
                d={penPreviewPath}
                fill="none"
                stroke="#404040"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </svg>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void handleImageFile(file, viewportCenterFlowPos())
        }}
      />
      <BoardToolbar
        activeTool={activeTool}
        onSelectTool={() => {
          setActiveTool('select')
          setPlacing(null)
          setPlacePos(null)
        }}
        onPenTool={() => {
          setPlacing(null)
          setPlacePos(null)
          setActiveTool((t) => (t === 'pen' ? 'select' : 'pen'))
        }}
        placing={placing}
        onPickPlace={(kind) => {
          setActiveTool('select')
          setPlacePos(null)
          setPlacing((cur) => (cur === kind ? null : kind))
        }}
        onImageClick={() => fileInputRef.current?.click()}
        selectedIds={selectedIds}
        onRecolor={recolorSelected}
        color={color}
        onColorChange={setColor}
        translucent={translucent}
        onTranslucentChange={setTranslucent}
      />
      <BoardZoomControl />
      <BoardSyncBadge />
    </div>
  )
}

export function BoardMode() {
  return (
    <ReactFlowProvider>
      <BoardCanvas />
    </ReactFlowProvider>
  )
}
