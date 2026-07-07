import { useCallback, useEffect, useMemo } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useReactFlow,
  type Node as FlowNode,
  type NodeChange,
  type OnSelectionChangeParams,
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

  // ツリー側からのパン要求
  useEffect(() => {
    if (!panRequestId) return
    const target = nodes[panRequestId]
    if (target && target.type === 'sticky') {
      const d = stickyData(target)
      setCenter(d.x + d.w / 2, d.y + d.h / 2, { zoom: 1.1, duration: 400 })
    }
    clearPanRequest()
  }, [panRequestId, nodes, setCenter, clearPanRequest])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // ドラッグ中の position 変化は React Flow 側の見た目のみ反映される（controlledのため
      // 自前ストアを即時更新して追従させる。永続化はドラッグ終了時の onNodeDragStop）
      for (const change of changes) {
        if (change.type === 'position' && change.position && !change.dragging) {
          // 終了時は onNodeDragStop で処理
        }
      }
      // 位置のライブ反映: dragging中はローカルstateだけ更新したいが、controlledでは
      // ストアを経由する必要がある。ここでは applyNodeChanges 相当を data.x/y に反映。
      const positionChanges = changes.filter(
        (c): c is Extract<NodeChange, { type: 'position' }> => c.type === 'position' && !!c.position,
      )
      if (positionChanges.length > 0) {
        const state = useEntityStore.getState()
        for (const c of positionChanges) {
          const n = state.nodes[c.id]
          if (n) {
            // ローカルのみ更新（API呼び出しなし）
            useEntityStore.setState((s) => ({
              nodes: {
                ...s.nodes,
                [c.id]: { ...n, data: { ...n.data, x: c.position!.x, y: c.position!.y } },
              },
            }))
          }
        }
      }
    },
    [],
  )

  const onNodeDragStop = useCallback(
    (_e: unknown, node: FlowNode) => {
      void updateNode(node.id, { data: { x: node.position.x, y: node.position.y } })
    },
    [updateNode],
  )

  const onSelectionChange = useCallback(
    ({ nodes: sel }: OnSelectionChangeParams) => {
      const ids = sel.map((n) => n.id)
      const current = useUiStore.getState().selectedIds
      if (ids.length === current.length && ids.every((id) => current.includes(id))) return
      setSelected(ids)
    },
    [setSelected],
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
        onSelectionChange={onSelectionChange}
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
