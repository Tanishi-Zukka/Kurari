import { useMemo, useState } from 'react'
import { useStore, type NodeProps } from '@xyflow/react'
import { childrenOf, useEntityStore } from '@/stores/entity-store'
import { usePresenceStore } from '@/stores/presence-store'
import { useUiStore } from '@/stores/ui-store'
import { Button, Textarea } from '@/components/ui/primitives'
import { STROKE_COLORS } from './BoardNodes'
import type { CommentData, StickyColor } from '@/types/model'

type PinFlowData = { authorName?: string; authorColor?: StickyColor }

export function CommentPinNode({ id, data, selected }: NodeProps) {
  const pin = data as PinFlowData
  const zoom = useStore((s) => s.transform[2])
  const selectedCount = useUiStore((s) => s.selectedIds.length)
  const nodes = useEntityStore((s) => s.nodes)
  const createNode = useEntityStore((s) => s.createNode)
  const updateNode = useEntityStore((s) => s.updateNode)
  const identity = usePresenceStore((s) => s.identity)
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const comments = useMemo(
    () => childrenOf(nodes, id).filter((n) => n.type === 'comment'),
    [nodes, id],
  )
  const color = STROKE_COLORS[pin.authorColor ?? 'gray'] ?? STROKE_COLORS.gray
  const initial = (pin.authorName?.trim() || '匿').slice(0, 1).toUpperCase()

  const post = async () => {
    const text = draft.trim()
    if (!text || posting) return
    setPosting(true)
    try {
      await createNode({
        parentId: id,
        type: 'comment',
        name: text.slice(0, 30),
        data: {
          text,
          author: identity.name || '匿名',
          authorColor: identity.color,
          authorClientId: identity.clientId,
        } satisfies CommentData,
      })
      if (comments.length === 0) await updateNode(id, { name: text.slice(0, 30) })
      setDraft('')
    } finally {
      setPosting(false)
    }
  }

  return (
    <div style={{ width: 28, height: 28 }} onDoubleClick={(e) => e.stopPropagation()}>
      <div style={{ position: 'relative', transform: `scale(${1 / zoom})`, transformOrigin: 'top left' }}>
        <div
          data-testid="comment-pin"
          className="flex h-7 w-7 items-center justify-center border-2 border-white text-[11px] font-bold text-white shadow-md"
          style={{ backgroundColor: color, borderRadius: '0 50% 50% 50%', transform: 'rotate(45deg)' }}
        >
          <span style={{ transform: 'rotate(-45deg)' }}>{comments.length || initial}</span>
        </div>
        {selected && selectedCount === 1 && (
          <div
            data-testid="pin-popover"
            className="nodrag nopan nowheel absolute top-0 w-72 overflow-hidden rounded-lg border border-neutral-200 bg-white text-left shadow-xl"
            style={{ left: 34 }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <div className="max-h-64 space-y-2 overflow-y-auto p-3">
              {comments.length === 0 && <p className="py-3 text-center text-xs text-neutral-400">まだコメントはありません</p>}
              {comments.map((comment) => {
                const d = comment.data as Partial<CommentData>
                const authorColor = STROKE_COLORS[d.authorColor ?? 'gray'] ?? STROKE_COLORS.gray
                return (
                  <div key={comment.id} className="rounded-lg bg-neutral-50 px-3 py-2">
                    <div className="mb-0.5 flex items-baseline gap-2">
                      <span className="text-xs font-semibold" style={{ color: authorColor }}>{d.author === 'me' ? '自分' : d.author ?? '匿名'}</span>
                      <span className="text-[10px] text-neutral-400">{new Date(comment.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-[13px] text-neutral-800">{d.text ?? ''}</p>
                  </div>
                )
              })}
            </div>
            <div className="border-t border-neutral-100 p-3">
              <Textarea
                rows={2}
                value={draft}
                placeholder="コメントを書く…（⌘Enterで送信）"
                data-testid="pin-comment-input"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void post()
                }}
              />
              <div className="mt-2 flex justify-end">
                <Button size="sm" variant="primary" disabled={!draft.trim() || posting} onClick={() => void post()} data-testid="pin-comment-send">送信</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
