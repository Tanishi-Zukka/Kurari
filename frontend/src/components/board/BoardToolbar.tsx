import { useState } from 'react'
import { Button } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'
import { Plus, StickyNote } from 'lucide-react'
import type { StickyColor } from '@/types/model'

const COLORS: { color: StickyColor; className: string }[] = [
  { color: 'yellow', className: 'bg-amber-200' },
  { color: 'blue', className: 'bg-sky-200' },
  { color: 'pink', className: 'bg-pink-200' },
  { color: 'green', className: 'bg-emerald-200' },
]

export function BoardToolbar({ onCreate }: { onCreate: (color: StickyColor) => void }) {
  const [color, setColor] = useState<StickyColor>('yellow')

  return (
    <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 shadow-sm">
      <Button size="sm" variant="primary" onClick={() => onCreate(color)}>
        <Plus size={13} />
        <StickyNote size={13} />
        付箋
      </Button>
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
      <span className="text-[11px] text-neutral-400">キャンバスをダブルクリックでも作成</span>
    </div>
  )
}
