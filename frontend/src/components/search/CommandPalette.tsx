import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CheckCheck,
  FileText,
  Hash,
  HelpCircle,
  LayoutDashboard,
  Link,
  ListTodo,
  MessageSquare,
  MessagesSquare,
  Search,
  Sparkles,
  StickyNote,
  Type,
  type LucideIcon,
} from 'lucide-react'
import { useEntityStore } from '@/stores/entity-store'
import { useUiStore } from '@/stores/ui-store'
import { useNavigateToNode } from '@/lib/navigate-node'
import { searchNodes, type SearchHit } from '@/lib/search'
import { cn } from '@/lib/utils'
import type { NodeType } from '@/types/model'

const ICONS: Partial<Record<NodeType, LucideIcon>> = {
  board: LayoutDashboard,
  sticky: StickyNote,
  text_card: Type,
  shape: Type,
  document: FileText,
  block: Hash,
  chat_room: MessagesSquare,
  message: MessageSquare,
  comment: MessageSquare,
  ai_summary: Sparkles,
  decision: CheckCheck,
  open_question: HelpCircle,
  task: ListTodo,
  link: Link,
}

function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query.trim().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return text
  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi')
  return text.split(pattern).map((part, index) =>
    terms.some((term) => part.toLocaleLowerCase() === term.toLocaleLowerCase()) ? (
      <mark key={`${part}-${index}`} className="rounded-sm bg-yellow-200 px-0.5 text-inherit">
        {part}
      </mark>
    ) : (
      part
    ),
  )
}

export function CommandPalette() {
  const searchOpen = useUiStore((s) => s.searchOpen)
  const closeSearch = useUiStore((s) => s.closeSearch)
  const nodes = useEntityStore((s) => s.nodes)
  const navigateToNode = useNavigateToNode()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const hits = useMemo(() => searchNodes(nodes, query), [nodes, query])

  useEffect(() => {
    if (!searchOpen) return
    setQuery('')
    setSelectedIndex(0)
  }, [searchOpen])

  useEffect(() => {
    if (selectedIndex >= hits.length) setSelectedIndex(Math.max(0, hits.length - 1))
  }, [hits.length, selectedIndex])

  if (!searchOpen) return null

  const choose = (hit: SearchHit) => {
    closeSearch()
    if (hit.blockId && hit.node.type === 'document') {
      const { setActiveDoc, setSelected, requestDocScroll } = useUiStore.getState()
      setActiveDoc(hit.node.id)
      setSelected([hit.node.id])
      navigate('/doc')
      window.setTimeout(() => requestDocScroll(hit.blockId!), 150)
      return
    }
    navigateToNode(hit.node)
  }

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-start justify-center bg-black/30 pt-[15vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeSearch()
      }}
    >
      <div className="w-[560px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl">
        <div className="flex items-center gap-2 border-b border-neutral-200 px-3">
          <Search size={17} className="shrink-0 text-neutral-400" />
          <input
            autoFocus
            data-testid="search-input"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setSelectedIndex(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                closeSearch()
              } else if (event.key === 'ArrowDown') {
                event.preventDefault()
                if (hits.length) setSelectedIndex((index) => (index + 1) % hits.length)
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                if (hits.length) setSelectedIndex((index) => (index - 1 + hits.length) % hits.length)
              } else if (event.key === 'Enter' && hits[selectedIndex]) {
                event.preventDefault()
                choose(hits[selectedIndex])
              }
            }}
            placeholder="ワークスペースを検索…"
            className="h-12 min-w-0 flex-1 bg-transparent text-sm text-neutral-800 outline-none placeholder:text-neutral-400"
          />
          <kbd className="rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-[10px] text-neutral-400">
            ESC
          </kbd>
        </div>
        <div className="max-h-[52vh] overflow-y-auto p-1.5">
          {hits.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-neutral-400">該当する項目がありません</div>
          ) : (
            hits.map((hit, index) => {
              const Icon = ICONS[hit.node.type] ?? FileText
              return (
                <button
                  key={`${hit.node.id}-${hit.blockId ?? ''}`}
                  type="button"
                  data-testid="search-result"
                  data-node-name={hit.node.name}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => choose(hit)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left',
                    index === selectedIndex ? 'bg-neutral-100' : 'hover:bg-neutral-50',
                  )}
                >
                  <Icon size={16} className="mt-0.5 shrink-0 text-neutral-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-neutral-800">
                      <Highlight text={hit.node.name || '（無題）'} query={query} />
                    </span>
                    {hit.snippet && (
                      <span className="mt-0.5 block truncate text-xs text-neutral-500">
                        <Highlight text={hit.snippet} query={query} />
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 shrink-0 text-[10px] text-neutral-400">{hit.node.type}</span>
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
