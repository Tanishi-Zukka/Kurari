import { childrenOf, useEntityStore } from '@/stores/entity-store'
import type { KNode } from '@/types/model'

/**
 * project 直下の固定名グループ（「AI Outputs」「意思決定ログ」「タスク」）を探し、
 * 無ければ作る。created は undo 履歴にグループも含めるかの判定に使う。
 */
export async function ensureProjectGroup(
  projectId: string,
  name: string,
): Promise<{ group: KNode; created: boolean }> {
  const { nodes, createNode } = useEntityStore.getState()
  const existing = childrenOf(nodes, projectId).find(
    (n) => n.type === 'group' && n.name === name,
  )
  if (existing) return { group: existing, created: false }
  const group = await createNode({ parentId: projectId, type: 'group', name })
  return { group, created: true }
}
