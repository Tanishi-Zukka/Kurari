import { create } from 'zustand'
import type { ServerEvent } from '@/types/model'
import {
  getAccessToken,
  setAccessToken,
  getJoinRequestId,
  setJoinRequestId,
} from '@/lib/access-token'
import { usePresenceStore } from '@/stores/presence-store'

export type AccessRole = 'loading' | 'owner' | 'member' | 'guest'

export type JoinState =
  | { phase: 'idle' }
  | { phase: 'requesting' }
  | { phase: 'waiting' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string }

export interface PendingRequest {
  requestId: string
  name: string
  ip?: string
  requestedAt: string
}

interface AccessState {
  role: AccessRole
  /** オーナーに届いている承認待ちリクエスト */
  pending: PendingRequest[]
  /** 参加リクエスト画面の状態 */
  joinState: JoinState
  /** 発行済みの招待URL（InviteButton の表示用） */
  inviteUrl: string | null

  refreshMe: () => Promise<void>
  /** ?invite= のトークンで参加リクエストを送り、承認をポーリングする */
  requestJoin: (name: string) => Promise<void>
  /** リロード後に承認待ちポーリングを再開する（joinRequestId が残っていれば） */
  resumePolling: () => void
  issueInvite: () => Promise<void>
  loadPending: () => Promise<void>
  approve: (requestId: string) => Promise<void>
  deny: (requestId: string) => Promise<void>
  applyAccessEvent: (ev: ServerEvent) => void
  /** 401 を受けたとき: トークンを破棄してゲートへ落とす（backend 再起動対応） */
  signOutToGuest: () => void
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAccessToken()
  const res = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...init,
  })
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.error?.message) message = body.error.message
    } catch {
      // keep default message
    }
    const err = new Error(message) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return (await res.json()) as T
}

let pollTimer: number | undefined

function stopPolling() {
  window.clearInterval(pollTimer)
  pollTimer = undefined
}

export const useAccessStore = create<AccessState>((set, get) => {
  const startPolling = (requestId: string) => {
    stopPolling()
    const tick = async () => {
      try {
        const r = await fetchJson<{ status: string; accessToken: string | null }>(
          `/api/access/join/${requestId}`,
        )
        if (r.status === 'approved' && r.accessToken) {
          stopPolling()
          setAccessToken(r.accessToken)
          setJoinRequestId(null)
          set({ joinState: { phase: 'idle' } })
          await get().refreshMe()
        } else if (r.status === 'denied') {
          stopPolling()
          setJoinRequestId(null)
          set({ joinState: { phase: 'denied' } })
        }
      } catch (e) {
        // 404 = リクエストが期限切れで掃除された
        if ((e as { status?: number }).status === 404) {
          stopPolling()
          setJoinRequestId(null)
          set({ joinState: { phase: 'error', message: 'リクエストの有効期限が切れました。もう一度お試しください' } })
        }
        // それ以外（一時的なネットワークエラー等）はポーリング継続
      }
    }
    void tick()
    pollTimer = window.setInterval(() => void tick(), 2000)
  }

  return {
    role: 'loading',
    pending: [],
    joinState: { phase: 'idle' },
    inviteUrl: null,

    refreshMe: async () => {
      try {
        const me = await fetchJson<{ role: AccessRole }>('/api/access/me')
        set({ role: me.role })
        if (me.role === 'owner') void get().loadPending()
      } catch {
        set({ role: 'guest' })
      }
    },

    requestJoin: async (name) => {
      const inviteToken = new URLSearchParams(location.search).get('invite')
      if (!inviteToken) {
        set({ joinState: { phase: 'error', message: '招待リンクが必要です' } })
        return
      }
      set({ joinState: { phase: 'requesting' } })
      const trimmed = name.trim().slice(0, 40) || 'ゲスト'
      // presence-store 経由で名前を反映する（localStorage 直書きだと store のメモリ上の
      // identity が古いままになり、承認後の presence join が空の名前になる・名前モーダルが再表示される）
      usePresenceStore.getState().setName(trimmed)
      const identity = usePresenceStore.getState().identity
      try {
        const r = await fetchJson<{ requestId: string }>('/api/access/join', {
          method: 'POST',
          body: JSON.stringify({ inviteToken, clientId: identity.clientId, name: trimmed }),
        })
        setJoinRequestId(r.requestId)
        set({ joinState: { phase: 'waiting' } })
        startPolling(r.requestId)
      } catch (e) {
        set({ joinState: { phase: 'error', message: (e as Error).message } })
      }
    },

    resumePolling: () => {
      const requestId = getJoinRequestId()
      if (requestId && !pollTimer) {
        set({ joinState: { phase: 'waiting' } })
        startPolling(requestId)
      }
    },

    issueInvite: async () => {
      const r = await fetchJson<{ token: string; expiresAt: string; lanIps: string[] }>(
        '/api/access/invite',
        { method: 'POST' },
      )
      const host = r.lanIps[0] ?? location.hostname
      const port = location.port ? `:${location.port}` : ''
      set({ inviteUrl: `${location.protocol}//${host}${port}/?invite=${r.token}` })
    },

    loadPending: async () => {
      try {
        set({ pending: await fetchJson<PendingRequest[]>('/api/access/pending') })
      } catch {
        // オーナー以外や一時エラーは無視
      }
    },

    approve: async (requestId) => {
      await fetchJson(`/api/access/pending/${requestId}/approve`, { method: 'POST' })
      set((s) => ({ pending: s.pending.filter((p) => p.requestId !== requestId) }))
    },

    deny: async (requestId) => {
      await fetchJson(`/api/access/pending/${requestId}/deny`, { method: 'POST' })
      set((s) => ({ pending: s.pending.filter((p) => p.requestId !== requestId) }))
    },

    applyAccessEvent: (ev) => {
      if (ev.type === 'access.requested') {
        set((s) =>
          s.pending.some((p) => p.requestId === ev.payload.requestId)
            ? s
            : { pending: [...s.pending, ev.payload] },
        )
      } else if (ev.type === 'access.resolved') {
        // 他タブで処理された分の同期
        set((s) => ({ pending: s.pending.filter((p) => p.requestId !== ev.payload.requestId) }))
      }
    },

    signOutToGuest: () => {
      setAccessToken(null)
      set({ role: 'guest', joinState: { phase: 'idle' } })
    },
  }
})
