import { useEffect, useRef, useState } from 'react'
import type { NodeProps, Node } from '@xyflow/react'
import { cn } from '@/lib/utils'
import { useEntityStore } from '@/stores/entity-store'
import type { StickyColor } from '@/types/model'

export type StickyFlowNode = Node<{ text: string; color: StickyColor }, 'sticky'>

const COLOR_CLASSES: Record<StickyColor, string> = {
  yellow: 'bg-amber-100 border-amber-300',
  blue: 'bg-sky-100 border-sky-300',
  pink: 'bg-pink-100 border-pink-300',
  green: 'bg-emerald-100 border-emerald-300',
}

/** 付箋本文の先頭行をツリー表示名に使う */
export function stickyNameFrom(text: string): string {
  return text.split('\n')[0]?.slice(0, 40) || '(empty sticky)'
}

export function StickyNode({ id, data, selected }: NodeProps<StickyFlowNode>) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(data.text)
  const updateNode = useEntityStore((s) => s.updateNode)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) {
      textareaRef.current?.focus()
      textareaRef.current?.select()
    }
  }, [editing])

  const commit = () => {
    setEditing(false)
    if (draft !== data.text) {
      void updateNode(id, { name: stickyNameFrom(draft), data: { text: draft } })
    }
  }

  return (
    <div
      className={cn(
        'h-full w-full rounded-lg border-2 p-2.5 shadow-sm transition-shadow',
        COLOR_CLASSES[data.color] ?? COLOR_CLASSES.yellow,
        selected && 'ring-2 ring-neutral-800/60 shadow-md',
      )}
      style={{ width: 220, minHeight: 120 }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        setDraft(data.text)
        setEditing(true)
      }}
    >
      {editing ? (
        <textarea
          ref={textareaRef}
          className="nodrag h-full min-h-[96px] w-full resize-none bg-transparent text-[13px] leading-snug text-neutral-800 outline-none"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit()
            if (e.key === 'Escape') {
              setDraft(data.text)
              setEditing(false)
            }
          }}
        />
      ) : (
        <p className="whitespace-pre-wrap text-[13px] leading-snug text-neutral-800">
          {data.text || <span className="text-neutral-400">ダブルクリックで編集</span>}
        </p>
      )}
    </div>
  )
}
