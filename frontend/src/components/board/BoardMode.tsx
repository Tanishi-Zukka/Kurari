import { useCallback, useEffect, useMemo } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  ConnectionMode,
  MarkerType,
  useReactFlow,
  useNodesInitialized,
  type Node as FlowNode,
  type Edge as FlowEdge,
  type NodeChange,
  type Connection,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { childrenOf, useEntityStore } from '@/stores/entity-store'
import { useUiStore } from '@/stores/ui-store'
import { StickyNode, TextCardNode, ShapeNode, stickyNameFrom } from './BoardNodes'
import { BoardToolbar, type NewItemKind } from './BoardToolbar'
import { stickyData, BOARD_ITEM_TYPES, type StickyColor, type NodeType } from '@/types/model'

const nodeTypes = { sticky: StickyNode, text_card: TextCardNode, shape: ShapeNode }

/** 種別ごとの新規作成時デフォルト */
const ITEM_DEFAULTS: Record<string, { w: number; h: number; data: Record<string, unknown> }> = {
  sticky: { w: 220, h: 120, data: {} },
  text_card: { w: 240, h: 60, data: {} },
  rect: { w: 180, h: 100, data: { kind: 'rect' } },
  ellipse: { w: 160, h: 110, data: { kind: 'ellipse' } },
}

function BoardCanvas() {
  const nodes = useEntityStore((s) => s.nodes)
  const edges = useEntityStore((s) => s.edges)
  const updateNode = useEntityStore((s) => s.updateNode)
  const removeNode = useEntityStore((s) => s.removeNode)
  const createNode = useEntityStore((s) => s.createNode)
  const createEdge = useEntityStore((s) => s.createEdge)
  const removeEdge = useEntityStore((s) => s.removeEdge)

  const activeBoardId = useUiStore((s) => s.activeBoardId)
  const selectedIds = useUiStore((s) => s.selectedIds)
  const setSelected = useUiStore((s) => s.setSelected)
  const panRequestId = useUiStore((s) => s.panRequestId)
  const clearPanRequest = useUiStore((s) => s.clearPanRequest)

  const { setCenter, screenToFlowPosition } = useReactFlow()
  const nodesInitialized = useNodesInitialized()

  // ストア → React Flow ノード（controlled）
  const flowNodes: FlowNode[] = useMemo(() => {
    if (!activeBoardId) return []
    return childrenOf(nodes, activeBoardId)
      .filter((n) => BOARD_ITEM_TYPES.includes(n.type))
      .map((n) => {
        const d = stickyData(n)
        return {
          id: n.id,
          type: n.type,
          position: { x: d.x, y: d.y },
          data: { text: d.text, color: d.color, kind: d.kind },
          selected: selectedIds.includes(n.id),
          width: d.w,
          height: d.h,
        }
      })
  }, [nodes, activeBoardId, selectedIds])

  // ストア → React Flow エッジ
  const flowEdges: FlowEdge[] = useMemo(() => {
    if (!activeBoardId) return []
    return Object.values(edges)
      .filter((e) => e.boardId === activeBoardId)
      .map((e) => ({
        id: e.id,
        source: e.sourceNodeId,
        target: e.targetNodeId,
        label: e.label || undefined,
      }))
  }, [edges, activeBoardId])

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

      // 2) ユーザーのクリック等による選択変更
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

  const onNodeDragStop = useCallback(
    (_e: unknown, node: FlowNode) => {
      void updateNode(node.id, { data: { x: node.position.x, y: node.position.y } })
    },
    [updateNode],
  )

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!activeBoardId || !conn.source || !conn.target || conn.source === conn.target) return
      void createEdge({
        boardId: activeBoardId,
        sourceNodeId: conn.source,
        targetNodeId: conn.target,
      })
    },
    [activeBoardId, createEdge],
  )

  const createItem = useCallback(
    async (kind: NewItemKind, pos: { x: number; y: number }, color: StickyColor) => {
      if (!activeBoardId) return
      const def = ITEM_DEFAULTS[kind]
      const type: NodeType = kind === 'rect' || kind === 'ellipse' ? 'shape' : kind
      const node = await createNode({
        parentId: activeBoardId,
        type,
        name: stickyNameFrom(''),
        data: {
          text: '',
          color,
          x: pos.x - def.w / 2,
          y: pos.y - def.h / 2,
          w: def.w,
          h: def.h,
          ...def.data,
        },
      })
      setSelected([node.id])
    },
    [activeBoardId, createNode, setSelected],
  )

  const onPaneDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      void createItem('sticky', pos, 'yellow')
    },
    [screenToFlowPosition, createItem],
  )

  const onNodesDelete = useCallback(
    (deleted: FlowNode[]) => {
      for (const n of deleted) void removeNode(n.id)
    },
    [removeNode],
  )

  const onEdgesDelete = useCallback(
    (deleted: FlowEdge[]) => {
      for (const e of deleted) void removeEdge(e.id)
    },
    [removeEdge],
  )

  if (!activeBoardId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-400">
        左のツリーからボードを選択してください
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
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
      >
        <Background gap={20} size={1.5} />
        <Controls showInteractive={false} />
      </ReactFlow>
      <BoardToolbar
        onCreate={(kind, color) => {
          // ビューポート中央に作成
          const el = document.querySelector('.react-flow')
          const rect = el?.getBoundingClientRect()
          const center = rect
            ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
            : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
          void createItem(kind, screenToFlowPosition(center), color)
        }}
      />
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
