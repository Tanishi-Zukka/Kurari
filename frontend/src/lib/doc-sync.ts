import { childrenOf, useEntityStore } from '@/stores/entity-store'

export interface HeadingInfo {
  blockId: string
  text: string
  level: number
}

/** カスタムスキーマにも対応するため、構造だけを見る緩い型 */
export interface LooseBlock {
  id: string
  type: string
  props?: Record<string, unknown>
  content?: unknown
  children?: LooseBlock[]
}

export interface BlockText {
  blockId: string
  text: string
}

/** BlockNote の全ブロックから、検索用にブロック単位の本文を抽出する。 */
export function extractAllText(blocks: LooseBlock[]): BlockText[] {
  const result: BlockText[] = []
  const walk = (items: LooseBlock[]) => {
    for (const block of items) {
      const text = Array.isArray(block.content)
        ? block.content.map((content: { text?: string }) => content.text ?? '').join('')
        : ''
      if (text.trim()) result.push({ blockId: block.id, text: text.trim() })
      if (block.children?.length) walk(block.children)
    }
  }
  walk(blocks)
  return result
}

/** BlockNote のブロック列から見出し(h1-h3)を抽出する */
export function extractHeadings(blocks: LooseBlock[]): HeadingInfo[] {
  const result: HeadingInfo[] = []
  const walk = (items: LooseBlock[]) => {
    for (const b of items) {
      if (b.type === 'heading') {
        const text = Array.isArray(b.content)
          ? b.content.map((c: { text?: string }) => c.text ?? '').join('')
          : ''
        const level = (b.props as { level?: number } | undefined)?.level ?? 1
        if (text.trim()) result.push({ blockId: b.id, text: text.trim(), level })
      }
      if (b.children?.length) walk(b.children)
    }
  }
  walk(blocks)
  return result
}

/**
 * ドキュメントの見出しを、document 配下の block ノードとしてツリーに同期する。
 * data.blockId でBlockNoteのブロックと対応づけ、追加・改名・並び・削除を反映する。
 */
export async function syncHeadingBlocks(docId: string, blocks: LooseBlock[]): Promise<void> {
  const { nodes, createNode, updateNode, removeNode } = useEntityStore.getState()
  const headings = extractHeadings(blocks)
  const existing = childrenOf(nodes, docId).filter((n) => n.type === 'block')
  const byBlockId = new Map(existing.map((n) => [n.data.blockId as string, n]))

  const seen = new Set<string>()
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]
    const orderKey = String(i).padStart(4, '0')
    seen.add(h.blockId)
    const node = byBlockId.get(h.blockId)
    if (!node) {
      await createNode({
        parentId: docId,
        type: 'block',
        name: h.text,
        orderKey,
        data: { blockId: h.blockId, level: h.level },
      })
    } else if (node.name !== h.text || node.orderKey !== orderKey || node.data.level !== h.level) {
      await updateNode(node.id, { name: h.text, orderKey, data: { level: h.level } })
    }
  }
  for (const node of existing) {
    if (!seen.has(node.data.blockId as string)) {
      await removeNode(node.id)
    }
  }
}
