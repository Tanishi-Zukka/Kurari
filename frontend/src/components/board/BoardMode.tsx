import { useCallback, useEffect, useMemo } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useReactFlow,
  useNodesInitialized,
  type Node as FlowNode,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { childrenOf, useEntityStore } from '@/stores/entity-store'
import { useUiStore } from '@/stores/ui-store'
import { StickyNode, stickyNameFrom } from './StickyNode'
import { BoardToolbar } from './BoardToolbar'
import { stickyData, type StickyColor } from '@/types/model'

const nodeTypes = { sticky: StickyNode }

function BoardCanvas() {
  const nodes = useEntityStore((s) => s.nodes)
  const updateNode = useEntityStore((s) => s.updateNode)
  const removeNode = useEntityStore((s) => s.removeNode)
  const createNode = useEntityStore((s) => s.createNode)

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
      .filter((n) => n.type === 'sticky')
      .map((n) => {
        const d = stickyData(n)
        return {
          id: n.id,
          type: 'sticky' as const,
          position: { x: d.x, y: d.y },
          data: { text: d.text, color: d.color },
          selected: selectedIds.includes(n.id),
          width: d.w,
          height: d.h,
        }
      })
  }, [nodes, activeBoardId, selectedIds])

  // ツリー側からのパン要求。
  // React Flow の初期化（ノード計測）が済む前に setCenter を呼ぶと
  // 内部ストアが無限再レンダリングに陥るため、nodesInitialized を待つ。
  useEffect(() => {
    if (!panRequestId || !nodesInitialized) return
    const target = nodes[panRequestId]
    if (target && target.type === 'sticky') {
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

  const createSticky = useCallback(
    async (pos: { x: number; y: number }, color: StickyColor = 'yellow') => {
      if (!activeBoardId) return
      const text = ''
      const node = await createNode({
        parentId: activeBoardId,
        type: 'sticky',
        name: stickyNameFrom(text),
        data: { text, color, x: pos.x, y: pos.y, w: 220, h: 120 },
      })
      setSelected([node.id])
    },
    [activeBoardId, createNode, setSelected],
  )

  const onPaneDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      void createSticky({ x: pos.x - 110, y: pos.y - 60 })
    },
    [screenToFlowPosition, createSticky],
  )

  const onNodesDelete = useCallback(
    (deleted: FlowNode[]) => {
      for (const n of deleted) void removeNode(n.id)
    },
    [removeNode],
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
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onNodesDelete={onNodesDelete}
        onDoubleClick={onPaneDoubleClick}
        zoomOnDoubleClick={false}
        fitView
        proOptions={{ hideAttribution: false }}
        deleteKeyCode={['Backspace', 'Delete']}
      >
        <Background gap={20} size={1.5} />
        <Controls showInteractive={false} />
      </ReactFlow>
      <BoardToolbar onCreate={(color) => {
        // ビューポート中央に作成
        const el = document.querySelector('.react-flow')
        const rect = el?.getBoundingClientRect()
        const center = rect
          ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
        const pos = screenToFlowPosition(center)
        void createSticky({ x: pos.x - 110, y: pos.y - 60 }, color)
      }} />
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
