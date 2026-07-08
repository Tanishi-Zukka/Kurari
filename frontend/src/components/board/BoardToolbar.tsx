import { useState } from 'react'
import { Button } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'
import { Plus, StickyNote, Type, Square, Circle } from 'lucide-react'
import type { StickyColor } from '@/types/model'

export type NewItemKind = 'sticky' | 'text_card' | 'rect' | 'ellipse'

const COLORS: { color: StickyColor; className: string }[] = [
  { color: 'yellow', className: 'bg-amber-200' },
  { color: 'blue', className: 'bg-sky-200' },
  { color: 'pink', className: 'bg-pink-200' },
  { color: 'green', className: 'bg-emerald-200' },
]

export function BoardToolbar({
  onCreate,
}: {
  onCreate: (kind: NewItemKind, color: StickyColor) => void
}) {
  const [color, setColor] = useState<StickyColor>('yellow')

  return (
    <div className="absolute left-1/2 top-3 z-10 flex w-max -translate-x-1/2 flex-nowrap items-center gap-2 whitespace-nowrap rounded-lg border border-neutral-200 bg-white px-2 py-1.5 shadow-sm">
      <Button size="sm" variant="primary" onClick={() => onCreate('sticky', color)} title="付箋を追加">
        <Plus size={13} />
        <StickyNote size={13} />
        付箋
      </Button>
      <Button size="sm" onClick={() => onCreate('text_card', color)} title="テキストカードを追加">
        <Type size={13} />
        テキスト
      </Button>
      <Button size="sm" onClick={() => onCreate('rect', color)} title="矩形を追加">
        <Square size={13} />
      </Button>
      <Button size="sm" onClick={() => onCreate('ellipse', color)} title="楕円を追加">
        <Circle size={13} />
      </Button>
      <div className="mx-1 h-5 w-px bg-neutral-200" />
      <div className="flex items-center gap-1">
        {COLORS.map((c) => (
          <button
            key={c.color}
            className={cn(
              'h-5 w-5 rounded-full border border-black/10 transition-transform',
              c.className,
              color === c.color && 'scale-110 ring-2 ring-neutral-500/50',
            )}
            onClick={() => setColor(c.color)}
            title={c.color}
          />
        ))}
      </div>
      <span className="hidden text-[11px] text-neutral-400 xl:inline">要素の縁からドラッグで接続</span>
    </div>
  )
}
