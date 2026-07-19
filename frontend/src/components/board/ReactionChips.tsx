import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useEntityStore } from '@/stores/entity-store'
import { usePresenceStore } from '@/stores/presence-store'
import { useHistoryStore } from '@/stores/history-store'
import { reactionsOf, type ReactionMap } from '@/types/model'
import { REACTION_EMOJIS } from '@/lib/reactions'
import { cn } from '@/lib/utils'

export function ReactionChips({ nodeId }: { nodeId: string }) {
  const node = useEntityStore((s) => s.nodes[nodeId])
  const updateNode = useEntityStore((s) => s.updateNode)
  const clientId = usePresenceStore((s) => s.identity.clientId)
  const [open, setOpen] = useState(false)
  if (!node) return null
  const reactions = reactionsOf(node)

  const toggle = (emoji: string) => {
    const prev = reactions
    const ids = prev[emoji] ?? []
    const nextIds = ids.includes(clientId) ? ids.filter((id) => id !== clientId) : [...ids, clientId]
    const next: ReactionMap = { ...prev }
    if (nextIds.length) next[emoji] = nextIds
    else delete next[emoji]
    const nextData = Object.keys(next).length ? next : null
    void updateNode(nodeId, { data: { reactions: nextData } })
    useHistoryStore.getState().push({
      undo: () => updateNode(nodeId, { data: { reactions: Object.keys(prev).length ? prev : null } }),
      redo: () => updateNode(nodeId, { data: { reactions: nextData } }),
    })
    setOpen(false)
  }
  const stop = (event: React.SyntheticEvent) => event.stopPropagation()
  return (
    <div className="nodrag absolute -bottom-7 left-0 z-20 flex items-center gap-1" onClick={stop} onDoubleClick={stop}>
      {Object.entries(reactions).map(([emoji, ids]) => (
        <button key={emoji} data-testid="reaction-chip" data-emoji={emoji} className={cn('rounded-full border border-neutral-200 bg-white px-1.5 py-0.5 text-[11px] shadow-sm', ids.includes(clientId) && 'ring-2 ring-sky-400')} onClick={() => toggle(emoji)}>{emoji} {ids.length}</button>
      ))}
      <div className="relative">
        <button data-testid="reaction-add" className="flex h-6 w-6 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 opacity-0 shadow-sm group-hover/item:opacity-100" onClick={() => setOpen((value) => !value)}><Plus size={12} /></button>
        {open && <div className="absolute left-0 top-7 flex gap-1 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg">{REACTION_EMOJIS.map((emoji) => <button key={emoji} data-testid={`reaction-emoji-${emoji}`} className="rounded p-1 hover:bg-neutral-100" onClick={() => toggle(emoji)}>{emoji}</button>)}</div>}
      </div>
    </div>
  )
}
