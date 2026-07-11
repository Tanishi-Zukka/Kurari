import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  ConnectionMode,
  MarkerType,
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
import { StickyNode, TextCardNode, ShapeNode, DrawingNode, ImageNode, stickyNameFrom, STROKE_COLORS } from './BoardNodes'
import { BoardEdge } from './BoardEdge'
import { BoardToolbar, type NewItemKind, type BoardTool } from './BoardToolbar'
import { BoardZoomControl } from './BoardZoomControl'
import { BoardSyncBadge } from './BoardSyncBadge'
import {
  stickyData,
  drawingData,
  imageData,
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
}

/** 画像配置時の最大辺。原寸の縦横比を保ったままこのサイズに収める */
const IMAGE_MAX_DIMENSION = 480
const IMAGE_FALLBACK_W = 320
const IMAGE_FALLBACK_H = 220

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

  const { setCenter, screenToFlowPosition } = useReactFlow()
  const nodesInitialized = useNodesInitialized()

  const [activeTool, setActiveTool] = useState<BoardTool>('select')
  const [color, setColor] = useState<StickyColor>('yellow')
  // エッジの選択状態。controlled 運用のため自前で保持する（曲げハンドルの表示に使う）
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([])

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

  // ストア → React Flow ノード（controlled）
  const flowNodes: FlowNode[] = useMemo(() => {
    if (!activeBoardId) return []
    return childrenOf(nodes, activeBoardId)
      .filter((n) => BOARD_ITEM_TYPES.includes(n.type))
      .map((n) => {
        // measured を明示的に渡す: controlled 運用では dimensions 変更を書き戻さない限り
        // React Flow の nodesInitialized が true にならず、パン等が永久に無効化されるため。
        // 寸法は自前管理（w/h）なのでそのまま渡してよい。
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
          }
        }
        const d = stickyData(n)
        return {
          id: n.id,
          type: n.type,
          position: { x: d.x, y: d.y },
          data: { text: d.text, color: d.color, kind: d.kind },
          selected: selectedIds.includes(n.id),
          width: d.w,
          height: d.h,
          measured: { width: d.w, height: d.h },
        }
      })
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
    if (target && BOARD_ITEM_TYPES.includes(target.type)) {
      const d = stickyData(target)
      setCenter(d.x + d.w / 2, d.y + d.h / 2, { zoom: 1.1, duration: 400 })
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

      // 3) ユーザーのクリック等による選択変更
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

  const onNodeDragStart = useCallback((_e: unknown, node: FlowNode) => {
    dragStartRef.current[node.id] = { x: node.position.x, y: node.position.y }
  }, [])

  const onNodeDragStop = useCallback(
    (_e: unknown, node: FlowNode) => {
      const start = dragStartRef.current[node.id]
      delete dragStartRef.current[node.id]
      const end = { x: node.position.x, y: node.position.y }
      void updateNode(node.id, { data: end })
      if (start && (start.x !== end.x || start.y !== end.y)) {
        useHistoryStore.getState().push({
          undo: () => updateNode(node.id, { data: start }),
          redo: () => updateNode(node.id, { data: end }),
        })
      }
    },
    [updateNode],
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

  const createItem = useCallback(
    async (kind: NewItemKind, pos: { x: number; y: number }, itemColor: StickyColor) => {
      if (!activeBoardId) return
      const def = ITEM_DEFAULTS[kind]
      const type: NodeType = kind === 'rect' || kind === 'ellipse' ? 'shape' : kind
      const node = await createNode({
        parentId: activeBoardId,
        type,
        name: stickyNameFrom(''),
        data: {
          text: '',
          color: itemColor,
          x: pos.x - def.w / 2,
          y: pos.y - def.h / 2,
          w: def.w,
          h: def.h,
          ...def.data,
        },
      })
      setSelected([node.id])
      useHistoryStore.getState().push({ undo: () => removeNode(node.id), redo: () => restoreNode(node) })
    },
    [activeBoardId, createNode, setSelected, removeNode, restoreNode],
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
        const node = await createNode({
          parentId: activeBoardId,
          type: 'image',
          name: '(image)',
          data: {
            url,
            x: pos.x - w / 2,
            y: pos.y - h / 2,
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
    [activeBoardId, createNode, setSelected, removeNode, restoreNode],
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
  }, [activeTool])

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
      const nodeSnapshots = delNodes.map((n) => state.nodes[n.id]).filter((n): n is KNode => !!n)
      const edgeSnapshots = delEdges.map((e) => state.edges[e.id]).filter((e): e is KEdge => !!e)
      if (nodeSnapshots.length === 0 && edgeSnapshots.length === 0) return
      for (const n of nodeSnapshots) void removeNode(n.id)
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
    (nextColor: StickyColor) => {
      const snapshot = useEntityStore.getState().nodes
      const targets = selectedIds
        .map((id) => snapshot[id])
        .filter((n): n is KNode => !!n && (n.type === 'sticky' || n.type === 'shape'))
      if (targets.length === 0) return
      const prevColors = new Map(
        targets.map((n) => [n.id, ((n.data as { color?: StickyColor }).color ?? 'yellow') as StickyColor]),
      )
      for (const n of targets) void updateNode(n.id, { data: { color: nextColor } })
      useHistoryStore.getState().push({
        undo: () => {
          for (const n of targets) void updateNode(n.id, { data: { color: prevColors.get(n.id) ?? 'yellow' } })
        },
        redo: () => {
          for (const n of targets) void updateNode(n.id, { data: { color: nextColor } })
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
        onDelete={onDelete}
        onConnect={onConnect}
        onDoubleClick={onPaneDoubleClick}
        connectionMode={ConnectionMode.Loose}
        defaultEdgeOptions={{
          markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
          style: { strokeWidth: 1.8 },
        }}
        zoomOnDoubleClick={false}
        fitView
        proOptions={{ hideAttribution: false }}
        deleteKeyCode={['Backspace', 'Delete']}
        panOnDrag={!isPen}
        nodesDraggable={!isPen}
        elementsSelectable={!isPen}
      >
        <Background gap={20} size={1.5} />
      </ReactFlow>
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
        onSelectTool={() => setActiveTool('select')}
        onPenTool={() => setActiveTool((t) => (t === 'pen' ? 'select' : 'pen'))}
        onCreate={(kind, c) => void createItem(kind, viewportCenterFlowPos(), c)}
        onImageClick={() => fileInputRef.current?.click()}
        selectedIds={selectedIds}
        onRecolor={recolorSelected}
        color={color}
        onColorChange={setColor}
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
