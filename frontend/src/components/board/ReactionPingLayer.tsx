import { ViewportPortal, useViewport } from '@xyflow/react'
import { useReactionStore } from '@/stores/reaction-store'
import { STROKE_COLORS } from './BoardNodes'

export function ReactionPingLayer({ boardId }: { boardId: string }) {
  const pings = useReactionStore((s) => s.pings)
  const { zoom } = useViewport()
  return (
    <ViewportPortal>
      {pings.filter((ping) => ping.boardId === boardId).map((ping) => (
        <div key={ping.id} style={{ position: 'absolute', left: ping.x, top: ping.y, transform: `scale(${1 / zoom})`, transformOrigin: 'center bottom', pointerEvents: 'none', zIndex: 1300 }}>
          <div className="reaction-float flex flex-col items-center" data-testid="reaction-ping" data-emoji={ping.emoji}>
            <span className="text-4xl drop-shadow-md">{ping.emoji}</span>
            <span className="rounded px-1.5 py-0.5 text-[10px] text-white" style={{ backgroundColor: STROKE_COLORS[ping.color] ?? STROKE_COLORS.gray }}>{ping.name}</span>
          </div>
        </div>
      ))}
    </ViewportPortal>
  )
}
