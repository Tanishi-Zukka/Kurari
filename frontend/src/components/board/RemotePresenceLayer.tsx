import { memo, useMemo } from 'react'
import { ViewportPortal, useViewport } from '@xyflow/react'
import { usePresenceStore } from '@/stores/presence-store'
import { useEntityStore } from '@/stores/entity-store'
import {
  absoluteXY,
  stickyData,
  BOARD_ITEM_TYPES,
  type KNode,
  type StickyColor,
} from '@/types/model'
import { STROKE_COLORS } from './BoardNodes'

/** 対象ノードがこのボード上の要素か（セクション配下も辿る） */
function isOnBoard(nodes: Record<string, KNode>, node: KNode, boardId: string): boolean {
  if (!BOARD_ITEM_TYPES.includes(node.type) && node.type !== 'section') return false
  let cur: KNode | undefined = node
  for (let i = 0; cur && i < 10; i++) {
    if (cur.parentId === boardId) return true
    cur = cur.parentId ? nodes[cur.parentId] : undefined
  }
  return false
}

/**
 * 他のメンバーのカーソルと選択ハイライトを flow 座標系に描くオーバーレイ。
 * useViewport はパンのたびに再レンダーを起こすため、このレイヤー内に隔離している
 * （BoardMode 本体では購読しないこと）。
 */
export function RemotePresenceLayer({ boardId }: { boardId: string }) {
  const clientId = usePresenceStore((s) => s.identity.clientId)
  const peers = usePresenceStore((s) => s.peers)
  const cursors = usePresenceStore((s) => s.cursors)
  const nodes = useEntityStore((s) => s.nodes)
  const { zoom } = useViewport()

  // このボードを見ている他人だけ（自分の別タブも除外）
  const visible = useMemo(
    () =>
      Object.values(peers).filter(
        (p) =>
          p.clientId !== clientId && p.location.mode === 'board' && p.location.boardId === boardId,
      ),
    [peers, clientId, boardId],
  )

  if (visible.length === 0) return null

  return (
    <ViewportPortal>
      {visible.map((peer) => {
        const state = cursors[peer.sessionId]
        const color = STROKE_COLORS[peer.color] ?? STROKE_COLORS.gray
        return (
          <div key={peer.sessionId} style={{ pointerEvents: 'none' }}>
            {state?.selectedIds.map((id) => {
              const node = nodes[id]
              if (!node || !isOnBoard(nodes, node, boardId)) return null
              const d = stickyData(node)
              const abs = absoluteXY(nodes, node)
              return (
                <div
                  key={id}
                  data-testid="remote-selection"
                  style={{
                    position: 'absolute',
                    left: abs.x - 3,
                    top: abs.y - 3,
                    width: d.w + 6,
                    height: d.h + 6,
                    border: `2px solid ${color}`,
                    borderRadius: 8,
                    zIndex: 1200,
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: -22,
                      left: -2,
                      transform: `scale(${1 / zoom})`,
                      transformOrigin: '0 100%',
                      backgroundColor: color,
                      color: '#fff',
                      fontSize: 10,
                      lineHeight: '14px',
                      padding: '1px 6px',
                      borderRadius: 4,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {peer.name}
                  </span>
                </div>
              )
            })}
            {state?.cursor && (
              <RemoteCursor
                x={state.cursor.x}
                y={state.cursor.y}
                zoom={zoom}
                colorKey={peer.color}
                name={peer.name}
              />
            )}
          </div>
        )
      })}
    </ViewportPortal>
  )
}

/** 1人分のカーソル。サイズはズーム非依存（scale(1/zoom)） */
const RemoteCursor = memo(function RemoteCursor({
  x,
  y,
  zoom,
  colorKey,
  name,
}: {
  x: number
  y: number
  zoom: number
  colorKey: StickyColor
  name: string
}) {
  const color = STROKE_COLORS[colorKey] ?? STROKE_COLORS.gray
  return (
    <div
      data-testid="remote-cursor"
      data-peer-name={name}
      style={{
        position: 'absolute',
        transform: `translate(${x}px, ${y}px) scale(${1 / zoom})`,
        transformOrigin: '0 0',
        zIndex: 1210,
      }}
    >
      <svg width="18" height="18" viewBox="0 0 18 18">
        <path
          d="M2 1 L2 15 L6 11.5 L8.7 17 L11 15.9 L8.4 10.6 L14 10 Z"
          fill={color}
          stroke="#fff"
          strokeWidth="1.2"
        />
      </svg>
      <span
        style={{
          position: 'absolute',
          left: 12,
          top: 16,
          backgroundColor: color,
          color: '#fff',
          fontSize: 10,
          lineHeight: '14px',
          padding: '1px 6px',
          borderRadius: 4,
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </span>
    </div>
  )
})
