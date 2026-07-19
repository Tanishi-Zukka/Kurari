import { extractAllText, type BlockText, type LooseBlock } from '@/lib/doc-sync'
import type { KNode, NodeType } from '@/types/model'

export interface SearchHit {
  node: KNode
  snippet: string
  blockId?: string
}

const EXCLUDED_TYPES = new Set<NodeType>(['workspace', 'drawing', 'image'])
const DATA_TEXT_TYPES = new Set<NodeType>([
  'sticky',
  'text_card',
  'shape',
  'message',
  'ai_summary',
  'decision',
  'open_question',
  'task',
  'comment',
  'comment_pin',
])

const documentTextCache = new Map<string, { updatedAt: string; lines: BlockText[] }>()

function documentLines(node: KNode): BlockText[] {
  const cached = documentTextCache.get(node.id)
  if (cached?.updatedAt === node.updatedAt) return cached.lines
  const blocks = Array.isArray(node.data.content) ? (node.data.content as LooseBlock[]) : []
  const lines = extractAllText(blocks)
  documentTextCache.set(node.id, { updatedAt: node.updatedAt, lines })
  return lines
}

function includesAll(text: string, terms: string[]): boolean {
  const normalized = text.toLocaleLowerCase()
  return terms.every((term) => normalized.includes(term))
}

function snippetAround(text: string, terms: string[]): string {
  const normalized = text.toLocaleLowerCase()
  const indexes = terms.map((term) => normalized.indexOf(term)).filter((index) => index >= 0)
  if (indexes.length === 0) return text.slice(0, 60)
  const first = Math.min(...indexes)
  const matchedLength = Math.max(...terms.map((term) => term.length), 1)
  const start = Math.max(0, first - 20)
  const end = Math.min(text.length, first + matchedLength + 20)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

/** ワークスペース内の全ノードを部分一致で横断検索する。 */
export function searchNodes(nodes: Record<string, KNode>, query: string): SearchHit[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const candidates = Object.values(nodes).filter((node) => !EXCLUDED_TYPES.has(node.type))
  if (!normalizedQuery) {
    return candidates
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, 10)
      .map((node) => ({ node, snippet: node.name }))
  }

  const terms = normalizedQuery.split(/\s+/).filter(Boolean)
  const scored: Array<SearchHit & { score: number }> = []
  for (const node of candidates) {
    const name = node.name ?? ''
    const normalizedName = name.toLocaleLowerCase()
    let body = ''
    let lines: BlockText[] = []
    if (node.type === 'document') {
      lines = documentLines(node)
      body = lines.map((line) => line.text).join('\n')
    } else if (DATA_TEXT_TYPES.has(node.type)) {
      body = String(node.data.text ?? '')
    }

    const searchable = `${name}\n${body}`
    if (!includesAll(searchable, terms)) continue

    const nameHasAll = includesAll(name, terms)
    const score = normalizedName.startsWith(normalizedQuery) ? 3 : nameHasAll ? 2 : 1
    const matchingLine = lines.find((line) => includesAll(line.text, terms))
      ?? lines.find((line) => terms.some((term) => line.text.toLocaleLowerCase().includes(term)))
    const snippetSource = nameHasAll ? body || name : matchingLine?.text || body || name
    scored.push({
      node,
      snippet: snippetAround(snippetSource, terms),
      blockId: node.type === 'document' && !nameHasAll ? matchingLine?.blockId : undefined,
      score,
    })
  }

  return scored
    .sort((a, b) => b.score - a.score || Date.parse(b.node.updatedAt) - Date.parse(a.node.updatedAt))
    .slice(0, 20)
    .map(({ node, snippet, blockId }) => ({ node, snippet, blockId }))
}
