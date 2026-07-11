import { Button } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'
import { useReactFlow } from '@xyflow/react'
import {
  MousePointer2,
  StickyNote,
  Type,
  Square,
  Circle,
  ArrowRight,
  PenLine,
  Image as ImageIcon,
  Trash2,
  Undo2,
  Redo2,
} from 'lucide-react'
import { useHistoryStore } from '@/stores/history-store'
import { useUiStore } from '@/stores/ui-store'
import type { StickyColor } from '@/types/model'

export type NewItemKind = 'sticky' | 'text_card' | 'rect' | 'ellipse'
export type BoardTool = 'select' | 'pen'

const COLORS: { color: StickyColor; className: string }[] = [
  { color: 'yellow', className: 'bg-amber-200' },
  { color: 'blue', className: 'bg-sky-200' },
  { color: 'pink', className: 'bg-pink-200' },
  { color: 'green', className: 'bg-emerald-200' },
  { color: 'gray', className: 'bg-neutral-300' },
]

export function BoardToolbar({
  activeTool,
  onSelectTool,
  onPenTool,
  onCreate,
  onImageClick,
  selectedIds,
  onRecolor,
  color,
  onColorChange,
}: {
  activeTool: BoardTool
  onSelectTool: () => void
  onPenTool: () => void
  onCreate: (kind: NewItemKind, color: StickyColor) => void
  onImageClick: () => void
  selectedIds: string[]
  onRecolor: (color: StickyColor) => void
  color: StickyColor
  onColorChange: (color: StickyColor) => void
}) {
  const { getNodes, getEdges, deleteElements } = useReactFlow()
  const canUndo = useHistoryStore((s) => s.past.length > 0)
  const canRedo = useHistoryStore((s) => s.future.length > 0)
  const undo = useHistoryStore((s) => s.undo)
  const redo = useHistoryStore((s) => s.redo)
  const showHandles = useUiStore((s) => s.showHandles)
  const toggleShowHandles = useUiStore((s) => s.toggleShowHandles)

  const hasSelection = selectedIds.length > 0

  const handleDelete = () => {
    const nodes = getNodes().filter((n) => n.selected)
    const edges = getEdges().filter((e) => e.selected)
    if (nodes.length === 0 && edges.length === 0) return
    void deleteElements({ nodes, edges })
  }

  const handleColorClick = (c: StickyColor) => {
    onColorChange(c)
    if (hasSelection) onRecolor(c)
  }

  return (
    <div className="absolute left-1/2 top-3 z-10 flex w-max -translate-x-1/2 flex-nowrap items-center gap-1 whitespace-nowrap rounded-lg border border-neutral-200 bg-white px-2 py-1.5 shadow-sm">
      <Button
        size="icon"
        variant={activeTool === 'select' ? 'primary' : 'ghost'}
        onClick={onSelectTool}
        title="選択"
      >
        <MousePointer2 size={15} />
      </Button>
      <Button size="icon" variant="ghost" onClick={() => onCreate('sticky', color)} title="付箋を追加">
        <StickyNote size={15} />
      </Button>
      <Button size="icon" variant="ghost" onClick={() => onCreate('text_card', color)} title="テキストカードを追加">
        <Type size={15} />
      </Button>
      <Button size="icon" variant="ghost" onClick={() => onCreate('rect', color)} title="矩形を追加">
        <Square size={15} />
      </Button>
      <Button size="icon" variant="ghost" onClick={() => onCreate('ellipse', color)} title="楕円を追加">
        <Circle size={15} />
      </Button>
      <Button
        size="icon"
        variant={showHandles ? 'primary' : 'ghost'}
        onClick={toggleShowHandles}
        title="接続ハンドルを表示"
      >
        <ArrowRight size={15} />
      </Button>
      <Button
        size="icon"
        variant={activeTool === 'pen' ? 'primary' : 'ghost'}
        onClick={onPenTool}
        title="ペンで描画"
      >
        <PenLine size={15} />
      </Button>
      <Button size="icon" variant="ghost" onClick={onImageClick} title="画像を追加">
        <ImageIcon size={15} />
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
            onClick={() => handleColorClick(c.color)}
            title={hasSelection ? `選択範囲の色を変更: ${c.color}` : c.color}
          />
        ))}
      </div>
      <div className="mx-1 h-5 w-px bg-neutral-200" />
      <Button size="icon" variant="ghost" onClick={handleDelete} disabled={!hasSelection} title="削除">
        <Trash2 size={15} />
      </Button>
      <Button size="icon" variant="ghost" onClick={() => void undo()} disabled={!canUndo} title="元に戻す">
        <Undo2 size={15} />
      </Button>
      <Button size="icon" variant="ghost" onClick={() => void redo()} disabled={!canRedo} title="やり直す">
        <Redo2 size={15} />
      </Button>
    </div>
  )
}
