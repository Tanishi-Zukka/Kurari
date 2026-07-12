import { useEntityStore } from '@/stores/entity-store'
import { ensureProjectGroup } from '@/lib/node-containers'
import { pushCreatedHistory } from '@/lib/history-utils'
import { gridBelowBoard } from '@/lib/board-layout'
import { stickyNameFrom } from '@/components/board/BoardNodes'
import type { KNode } from '@/types/model'

export type DeriveKind = 'task' | 'decision' | 'open_question'

/** 派生先グループの固定名（find-or-create 規約） */
export const DERIVE_GROUP_NAMES: Record<DeriveKind, string> = {
  task: 'タスク',
  decision: '意思決定ログ',
  open_question: '意思決定ログ',
}

/** 派生元ノードの本文（text が無ければ name） */
function sourceText(node: KNode): string {
  const t = (node.data as { text?: unknown }).text
  return typeof t === 'string' && t.trim() ? t.trim() : node.name
}

/** 祖先をたどって所属 project を返す。見つからなければ唯一の project にフォールバック */
function projectIdOf(node: KNode): string | null {
  const nodes = useEntityStore.getState().nodes
  let cur: KNode | undefined = node
  while (cur) {
    if (cur.type === 'project') return cur.id
    cur = cur.parentId ? nodes[cur.parentId] : undefined
  }
  return Object.values(nodes).find((n) => n.type === 'project')?.id ?? null
}

/**
 * 派生操作の中核: 元ノードは残し、data.derivedFrom 付きの新ノードを
 * project 直下のグループ（タスク / 意思決定ログ）に作る。1回のundoで全部消える。
 */
export async function deriveNodes(sources: KNode[], kind: DeriveKind): Promise<KNode[]> {
  if (sources.length === 0) return []
  const projectId = projectIdOf(sources[0])
  if (!projectId) return []
  const { createNode } = useEntityStore.getState()
  const { group, created: groupCreated } = await ensureProjectGroup(
    projectId,
    DERIVE_GROUP_NAMES[kind],
  )
  const created: KNode[] = []
  for (const source of sources) {
    const text = sourceText(source)
    created.push(
      await createNode({
        parentId: group.id,
        type: kind,
        name: text.replace(/\n/g, ' ').slice(0, 60),
        data:
          kind === 'task'
            ? { text, done: false, derivedFrom: source.id }
            : { text, derivedFrom: source.id },
      }),
    )
  }
  pushCreatedHistory(groupCreated ? [group, ...created] : created)
  return created
}

/** メッセージ等を指定ボードの既存要素の下に付箋として派生させる */
export async function deriveSticky(source: KNode, boardId: string): Promise<KNode> {
  const { nodes, createNode } = useEntityStore.getState()
  const text = sourceText(source)
  const [pos] = gridBelowBoard(nodes, boardId, 1)
  const node = await createNode({
    parentId: boardId,
    type: 'sticky',
    name: stickyNameFrom(text),
    data: { text, color: 'yellow', derivedFrom: source.id, x: pos.x, y: pos.y, w: 220, h: 180 },
  })
  pushCreatedHistory([node])
  return node
}
