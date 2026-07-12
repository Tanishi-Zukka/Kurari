import { useEntityStore } from '@/stores/entity-store'
import { useHistoryStore } from '@/stores/history-store'
import type { KNode } from '@/types/model'

/**
 * 作成したノード群を1回のundoで消せるように history に積む。
 * created は親→子の順で渡すこと（undo は逆順で子から消し、redo は親から復元する）。
 */
export function pushCreatedHistory(created: KNode[]) {
  const { removeNode, restoreNode } = useEntityStore.getState()
  useHistoryStore.getState().push({
    undo: async () => {
      for (const n of [...created].reverse()) await removeNode(n.id)
    },
    redo: async () => {
      for (const n of created) await restoreNode(n)
    },
  })
}
