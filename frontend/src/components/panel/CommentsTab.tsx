import { useMemo, useState } from 'react'
import { childrenOf, useEntityStore } from '@/stores/entity-store'
import { Button, Textarea } from '@/components/ui/primitives'
import type { CommentData } from '@/types/model'
import { MessageSquare } from 'lucide-react'

export function CommentsTab({ contextNodeId }: { contextNodeId: string | null }) {
  const nodes = useEntityStore((s) => s.nodes)
  const createNode = useEntityStore((s) => s.createNode)
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)

  const comments = useMemo(() => {
    if (!contextNodeId) return []
    return childrenOf(nodes, contextNodeId).filter((n) => n.type === 'comment')
  }, [nodes, contextNodeId])

  const post = async () => {
    const text = draft.trim()
    if (!text || !contextNodeId || posting) return
    setPosting(true)
    try {
      await createNode({
        parentId: contextNodeId,
        type: 'comment',
        name: text.slice(0, 30),
        data: { text, author: 'me' } satisfies CommentData,
      })
      setDraft('')
    } finally {
      setPosting(false)
    }
  }

  if (!contextNodeId) {
    return <p className="p-4 text-xs text-neutral-400">付箋やボードを選択するとコメントできます</p>
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {comments.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-neutral-300">
            <MessageSquare size={20} />
            <p className="text-xs">まだコメントはありません</p>
          </div>
        )}
        {comments.map((c) => {
          const d = c.data as Partial<CommentData>
          return (
            <div key={c.id} className="rounded-lg bg-neutral-50 px-3 py-2">
              <div className="mb-0.5 flex items-baseline gap-2">
                <span className="text-xs font-semibold text-neutral-700">{d.author ?? 'me'}</span>
                <span className="text-[10px] text-neutral-400">
                  {new Date(c.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-[13px] text-neutral-800">{d.text ?? ''}</p>
            </div>
          )
        })}
      </div>
      <div className="border-t border-neutral-100 p-3">
        <Textarea
          rows={2}
          placeholder="コメントを書く…（⌘Enterで送信）"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void post()
          }}
        />
        <div className="mt-2 flex justify-end">
          <Button size="sm" variant="primary" disabled={!draft.trim() || posting} onClick={() => void post()}>
            送信
          </Button>
        </div>
      </div>
    </div>
  )
}
