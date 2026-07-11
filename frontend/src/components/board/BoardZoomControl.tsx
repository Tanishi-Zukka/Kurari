import { Minus, Plus } from 'lucide-react'
import { useReactFlow, useViewport } from '@xyflow/react'
import { Button } from '@/components/ui/primitives'

/** ボード左下のズーム操作ピル。ツールバーと同じ見た目に揃える */
export function BoardZoomControl() {
  const { zoomIn, zoomOut } = useReactFlow()
  const { zoom } = useViewport()

  return (
    <div className="absolute bottom-3 left-3 z-10 flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-1.5 py-1 shadow-sm">
      <Button size="icon" variant="ghost" onClick={() => void zoomOut()} title="縮小">
        <Minus size={14} />
      </Button>
      <span className="w-10 text-center text-[11px] tabular-nums text-neutral-600">
        {Math.round(zoom * 100)}%
      </span>
      <Button size="icon" variant="ghost" onClick={() => void zoomIn()} title="拡大">
        <Plus size={14} />
      </Button>
    </div>
  )
}
