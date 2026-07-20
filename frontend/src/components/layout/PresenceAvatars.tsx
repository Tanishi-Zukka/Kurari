import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePresenceStore, type PeerMeta } from '@/stores/presence-store'
import { useUiStore } from '@/stores/ui-store'
import { useEntityStore } from '@/stores/entity-store'
import { STROKE_COLORS } from '@/components/board/BoardNodes'

const MODE_LABELS: Record<string, string> = { board: 'Board', doc: 'Doc', tasks: 'Tasks', ai: 'AI', call: 'Call' }

/** ヘッダーに出すオンラインメンバーのアバター群。他人クリックでその人の場所へジャンプ、自分クリックで名前変更 */
export function PresenceAvatars() {
  const identity = usePresenceStore((s) => s.identity)
  const peers = usePresenceStore((s) => s.peers)
  const nodes = useEntityStore((s) => s.nodes)
  const setActiveBoard = useUiStore((s) => s.setActiveBoard)
  const setActiveDoc = useUiStore((s) => s.setActiveDoc)
  const requestPanPoint = useUiStore((s) => s.requestPanPoint)
  const navigate = useNavigate()

  // clientId で重複排除（同一人物の複数タブは1つに）。自分は先頭に固定
  const { self, others } = useMemo(() => {
    const byClient = new Map<string, PeerMeta>()
    for (const p of Object.values(peers)) {
      if (!byClient.has(p.clientId)) byClient.set(p.clientId, p)
    }
    const list = [...byClient.values()]
    return {
      self: list.find((p) => p.clientId === identity.clientId) ?? null,
      others: list
        .filter((p) => p.clientId !== identity.clientId)
        .sort((a, b) => a.name.localeCompare(b.name, 'ja')),
    }
  }, [peers, identity.clientId])

  const locationLabel = (peer: PeerMeta) => {
    const loc = peer.location
    const target =
      (loc.mode === 'board' && loc.boardId && nodes[loc.boardId]?.name) ||
      (loc.mode === 'doc' && loc.docId && nodes[loc.docId]?.name) ||
      null
    return `${MODE_LABELS[loc.mode] ?? loc.mode}${target ? `: ${target}` : ''}`
  }

  const jumpTo = (peer: PeerMeta) => {
    const loc = peer.location
    if (loc.mode === 'board' && loc.boardId) {
      setActiveBoard(loc.boardId)
      // 相手のカーソル位置が分かればそこへパン
      const cursor = usePresenceStore.getState().cursors[peer.sessionId]?.cursor
      if (cursor) requestPanPoint({ x: cursor.x, y: cursor.y })
      navigate('/board')
    } else if (loc.mode === 'doc' && loc.docId) {
      setActiveDoc(loc.docId)
      navigate('/doc')
    } else {
      navigate(`/${loc.mode}`)
    }
  }

  return (
    <div className="flex items-center" data-testid="presence-avatars">
      {self && <SelfAvatar peer={self} />}
      {others.map((peer) => (
        <button
          key={peer.clientId}
          data-testid="presence-avatar"
          data-peer-name={peer.name}
          className="-ml-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-[11px] font-semibold text-white transition-transform hover:scale-110"
          style={{ backgroundColor: STROKE_COLORS[peer.color] ?? STROKE_COLORS.gray }}
          title={`${peer.name} — ${locationLabel(peer)}（クリックでジャンプ）`}
          onClick={() => jumpTo(peer)}
        >
          {(peer.name || '?').slice(0, 1).toUpperCase()}
        </button>
      ))}
    </div>
  )
}

/** 自分のアバター。クリックで名前変更ポップオーバー */
function SelfAvatar({ peer }: { peer: PeerMeta }) {
  const setName = usePresenceStore((s) => s.setName)
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(peer.name)
  const ref = useRef<HTMLDivElement>(null)

  const commit = () => {
    const name = value.trim()
    if (name && name !== peer.name) setName(name)
    setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        data-testid="presence-avatar-self"
        className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-white ring-2 ring-neutral-800/70 transition-transform hover:scale-110"
        style={{ backgroundColor: STROKE_COLORS[peer.color] ?? STROKE_COLORS.gray }}
        title={`${peer.name}（自分） — クリックで名前を変更`}
        onClick={() => {
          setValue(peer.name)
          setOpen((v) => !v)
        }}
      >
        {(peer.name || '?').slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-[1300] w-56 rounded-lg border border-neutral-200 bg-white p-3 shadow-lg">
          <div className="text-xs font-medium text-neutral-600">表示名</div>
          <input
            autoFocus
            className="mt-1.5 w-full rounded border border-neutral-300 px-2 py-1 text-sm outline-none focus:border-neutral-500"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setOpen(false)
            }}
            onBlur={commit}
          />
        </div>
      )}
    </div>
  )
}
