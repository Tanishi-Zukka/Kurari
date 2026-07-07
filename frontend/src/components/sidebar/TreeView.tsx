import { useMemo } from 'react'
import { childrenOf, useEntityStore } from '@/stores/entity-store'
import { useUiStore } from '@/stores/ui-store'
import { TreeNodeRow } from './TreeNode'
import type { KNode } from '@/types/model'

export interface TreeItem {
  node: KNode
  depth: number
  children: TreeItem[]
}

function buildTree(nodes: Record<string, KNode>, parentId: string | null, depth: number): TreeItem[] {
  return childrenOf(nodes, parentId).map((node) => ({
    node,
    depth,
    children: buildTree(nodes, node.id, depth + 1),
  }))
}

export function TreeView() {
  const nodes = useEntityStore((s) => s.nodes)
  const workspaceId = useEntityStore((s) => s.workspaceId)
  const loadError = useEntityStore((s) => s.loadError)
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)

  const tree = useMemo(() => {
    if (!workspaceId || !nodes[workspaceId]) return []
    return [
      {
        node: nodes[workspaceId],
        depth: 0,
        children: buildTree(nodes, workspaceId, 1),
      },
    ]
  }, [nodes, workspaceId])

  if (!sidebarOpen) return null

  return (
    <aside className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-neutral-200 bg-neutral-50">
      <div className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
        Structure
      </div>
      <div className="flex-1 overflow-y-auto px-1.5 pb-3">
        {loadError && (
          <p className="px-2 py-1 text-xs text-red-600">読み込みエラー: {loadError}</p>
        )}
        {tree.length === 0 && !loadError && (
          <p className="px-2 py-1 text-xs text-neutral-400">Loading…</p>
        )}
        {tree.map((item) => (
          <TreeNodeRow key={item.node.id} item={item} />
        ))}
      </div>
    </aside>
  )
}
