import { create } from 'zustand'
import type {
  PresenceCursor,
  PresenceLocation,
  PresencePeer,
  ServerEvent,
  StickyColor,
} from '@/types/model'
import { loadIdentity, saveIdentity, type Identity } from '@/lib/identity'

/** 低頻度で変わるピア情報。カーソル（20Hz）とはマップを分けて購読側の再レンダーを抑える */
export interface PeerMeta {
  sessionId: string
  clientId: string
  name: string
  color: StickyColor
  location: PresenceLocation
}

interface PeerCursor {
  cursor: PresenceCursor | null
  selectedIds: string[]
}

interface PresenceState {
  identity: Identity
  selfSessionId: string | null
  /** sessionId → メタ情報（名前・色・居場所）。自分の分も含む */
  peers: Record<string, PeerMeta>
  /** sessionId → カーソル・選択。高頻度更新はこちらだけを触る */
  cursors: Record<string, PeerCursor>
  /** 自分がいま編集中のドキュメント（DocumentMode が設定） */
  editingDocId: string | null

  bindSender: (send: (msg: object) => void) => void
  applyPresenceEvent: (ev: ServerEvent) => void
  /** WS open のたびに呼ぶ（再接続時のプレゼンス復元を兼ねる） */
  sendJoin: () => void
  /** TTL 退室を防ぐ空 update（30秒周期で呼ぶ） */
  sendKeepalive: () => void
  /** 居場所・選択の変化を送信（usePresenceLocation から） */
  reportLocation: (location: PresenceLocation, selectedIds: string[]) => void
  /** ボード上のカーソル送信（内部で 50ms throttle） */
  sendCursor: (cursor: PresenceCursor | null) => void
  setName: (name: string) => void
  setEditingDoc: (docId: string | null) => void
}

// 送信系の可変状態は再レンダー不要なのでモジュール変数に持つ
let sender: ((msg: object) => void) | null = null
let lastLocation: PresenceLocation = { mode: 'board' }
let lastSelectedIds: string[] = []
let lastCursorSentAt = 0
let cursorTimer: number | undefined
let pendingCursor: PresenceCursor | null = null
let hasPendingCursor = false

function send(type: string, payload: object) {
  sender?.({ type, payload })
}

function toMeta(p: PresencePeer): PeerMeta {
  return {
    sessionId: p.sessionId,
    clientId: p.clientId,
    name: p.name,
    color: p.color,
    location: p.location,
  }
}

function sameMeta(a: PeerMeta, b: PeerMeta): boolean {
  return (
    a.clientId === b.clientId &&
    a.name === b.name &&
    a.color === b.color &&
    a.location.mode === b.location.mode &&
    a.location.boardId === b.location.boardId &&
    a.location.docId === b.location.docId &&
    a.location.editing === b.location.editing
  )
}

function splitPeers(list: PresencePeer[]): Pick<PresenceState, 'peers' | 'cursors'> {
  const peers: Record<string, PeerMeta> = {}
  const cursors: Record<string, PeerCursor> = {}
  for (const p of list) {
    peers[p.sessionId] = toMeta(p)
    cursors[p.sessionId] = { cursor: p.cursor, selectedIds: p.selectedIds }
  }
  return { peers, cursors }
}

export const usePresenceStore = create<PresenceState>((set, get) => ({
  identity: loadIdentity(),
  selfSessionId: null,
  peers: {},
  cursors: {},
  editingDocId: null,

  bindSender: (fn) => {
    sender = fn
  },

  applyPresenceEvent: (ev) => {
    if (ev.type === 'presence.joined') {
      set({ selfSessionId: ev.payload.sessionId, ...splitPeers(ev.payload.peers) })
    } else if (ev.type === 'presence.peers') {
      set(splitPeers(ev.payload))
    } else if (ev.type === 'presence.updated') {
      const p = ev.payload
      set((s) => {
        const meta = toMeta(p)
        const prev = s.peers[p.sessionId]
        return {
          // カーソルだけの変化ではpeersのオブジェクトを変えない（低頻度購読者を守る）
          peers: prev && sameMeta(prev, meta) ? s.peers : { ...s.peers, [p.sessionId]: meta },
          cursors: { ...s.cursors, [p.sessionId]: { cursor: p.cursor, selectedIds: p.selectedIds } },
        }
      })
    }
  },

  sendJoin: () => {
    const { identity } = get()
    send('presence.join', { ...identity, location: lastLocation, selectedIds: lastSelectedIds })
  },

  sendKeepalive: () => send('presence.update', {}),

  reportLocation: (location, selectedIds) => {
    lastLocation = location
    lastSelectedIds = selectedIds
    send('presence.update', { location, selectedIds })
  },

  sendCursor: (cursor) => {
    pendingCursor = cursor
    hasPendingCursor = true
    if (cursorTimer !== undefined) return
    const flush = () => {
      cursorTimer = undefined
      if (!hasPendingCursor) return
      hasPendingCursor = false
      lastCursorSentAt = Date.now()
      send('presence.update', { cursor: pendingCursor })
    }
    const wait = 50 - (Date.now() - lastCursorSentAt)
    if (wait <= 0) flush()
    else cursorTimer = window.setTimeout(flush, wait)
  },

  setName: (name) => {
    const identity = { ...get().identity, name }
    saveIdentity(identity)
    set({ identity })
    send('presence.update', { name })
  },

  setEditingDoc: (docId) => {
    if (get().editingDocId !== docId) set({ editingDocId: docId })
  },
}))
