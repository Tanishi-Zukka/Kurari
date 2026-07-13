import { create } from 'zustand'
import type { CallParticipant, ServerEvent } from '@/types/model'
import type { WsState } from '@/lib/ws'
import { usePresenceStore } from '@/stores/presence-store'

export type CallStatus = 'idle' | 'joining' | 'joined' | 'error'

interface CallState {
  status: CallStatus
  errorMessage: string | null
  /** sessionId → 参加者（自分の分も含む）。ミュート等のバッジ表示はここから */
  participants: Record<string, CallParticipant>
  /** sessionId → 受信ストリーム（ontrack で確定） */
  remoteStreams: Record<string, MediaStream>
  localStream: MediaStream | null
  muted: boolean
  cameraOff: boolean

  bindSender: (send: (msg: object) => void) => void
  /** カメラ・マイクを取得して通話に参加する */
  join: () => Promise<void>
  leave: () => void
  toggleMute: () => void
  toggleCamera: () => void
  applyCallEvent: (ev: ServerEvent) => void
  /** WS の接続状態変化（App から呼ぶ）。再接続時は新セッションとして全 PeerConnection を張り直す */
  handleWsState: (state: WsState) => void
}

// LAN 内の host candidate だけで繋ぐ（サーバレス）。届かない環境が出たらここに STUN を足す
const RTC_CONFIG: RTCConfiguration = { iceServers: [] }

interface PeerEntry {
  pc: RTCPeerConnection
  polite: boolean
  makingOffer: boolean
  ignoreOffer: boolean
  isSettingRemoteAnswerPending: boolean
  /** このピア宛シグナルの直列実行チェーン（description 処理中に candidate が割り込むと落ちるため） */
  queue: Promise<void>
  /** remoteDescription 確定前に届いた candidate の待機列（確定後に流し込む） */
  pendingCandidates: RTCIceCandidateInit[]
}

// RTCPeerConnection や送信関数は再レンダー不要なのでモジュール変数に持つ
let sender: ((msg: object) => void) | null = null
const peers = new Map<string, PeerEntry>()
/** 参加の意思。WS 再接続時に call.join を送り直す判定に使う（leave で解除） */
let wantJoined = false

function send(type: string, payload: object) {
  sender?.({ type, payload })
}

function mediaErrorMessage(e: unknown): string {
  const name = (e as DOMException)?.name
  if (name === 'NotAllowedError') return 'カメラ・マイクの使用が許可されていません'
  if (name === 'NotFoundError') return 'カメラ・マイクが見つかりません'
  return 'カメラ・マイクを開始できません'
}

export const useCallStore = create<CallState>((set, get) => {
  const closePeer = (sessionId: string) => {
    const entry = peers.get(sessionId)
    if (!entry) return
    entry.pc.close()
    peers.delete(sessionId)
    set((s) => {
      if (!(sessionId in s.remoteStreams)) return s
      const remoteStreams = { ...s.remoteStreams }
      delete remoteStreams[sessionId]
      return { remoteStreams }
    })
  }

  const closeAllPeers = () => {
    for (const entry of peers.values()) entry.pc.close()
    peers.clear()
    set({ remoteStreams: {} })
  }

  /** 相手セッションとの PeerConnection を用意する（冪等）。glare は perfect negotiation で解消 */
  const ensurePeer = (peerId: string): PeerEntry | null => {
    const existing = peers.get(peerId)
    if (existing) return existing
    const localStream = get().localStream
    const selfSessionId = usePresenceStore.getState().selfSessionId
    if (!localStream || !selfSessionId || peerId === selfSessionId) return null

    const pc = new RTCPeerConnection(RTC_CONFIG)
    const entry: PeerEntry = {
      pc,
      // 衝突時に譲る側。sessionId の小さい方が polite（双方で判定が一致する）
      polite: selfSessionId < peerId,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      queue: Promise.resolve(),
      pendingCandidates: [],
    }
    peers.set(peerId, entry)

    for (const track of localStream.getTracks()) pc.addTrack(track, localStream)

    pc.onnegotiationneeded = async () => {
      try {
        entry.makingOffer = true
        await pc.setLocalDescription()
        send('call.signal', { to: peerId, description: pc.localDescription })
      } catch {
        // 衝突時の rollback 等で失敗しても perfect negotiation が回復する
      } finally {
        entry.makingOffer = false
      }
    }
    pc.onicecandidate = (e) => {
      send('call.signal', { to: peerId, candidate: e.candidate })
    }
    pc.ontrack = (e) => {
      const stream = e.streams[0]
      if (!stream) return
      set((s) =>
        s.remoteStreams[peerId] === stream
          ? s
          : { remoteStreams: { ...s.remoteStreams, [peerId]: stream } },
      )
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        pc.restartIce()
        set({ errorMessage: '接続できませんでした（同一LAN・ファイアウォールを確認してください）' })
      } else if (pc.connectionState === 'connected') {
        set((s) => (s.errorMessage ? { errorMessage: null } : s))
      }
    }
    return entry
  }

  /** participants の全量スナップショットと peers Map の差分を取り、接続を張る/畳む */
  const syncPeers = (list: CallParticipant[]) => {
    const alive = new Set(list.map((p) => p.sessionId))
    for (const p of list) ensurePeer(p.sessionId)
    for (const id of [...peers.keys()]) {
      if (!alive.has(id)) closePeer(id)
    }
  }

  const setParticipants = (list: CallParticipant[]) => {
    const participants: Record<string, CallParticipant> = {}
    for (const p of list) participants[p.sessionId] = p
    set({ participants })
  }

  /** perfect negotiation の受信側（MDN の標準実装 + candidate 待機列） */
  const handleSignal = async (
    entry: PeerEntry,
    from: string,
    description?: RTCSessionDescriptionInit,
    candidate?: RTCIceCandidateInit | null,
  ) => {
    const { pc } = entry
    if (description) {
      const readyForOffer =
        !entry.makingOffer && (pc.signalingState === 'stable' || entry.isSettingRemoteAnswerPending)
      const offerCollision = description.type === 'offer' && !readyForOffer
      entry.ignoreOffer = !entry.polite && offerCollision
      if (entry.ignoreOffer) return
      entry.isSettingRemoteAnswerPending = description.type === 'answer'
      await pc.setRemoteDescription(description)
      entry.isSettingRemoteAnswerPending = false
      // remoteDescription 確定を待っていた candidate を流し込む
      // （旧いネゴシエーションの残骸は addIceCandidate が拒否するので握りつぶす）
      for (const pending of entry.pendingCandidates.splice(0)) {
        await pc.addIceCandidate(pending).catch(() => {})
      }
      if (description.type === 'offer') {
        await pc.setLocalDescription()
        send('call.signal', { to: from, description: pc.localDescription })
      }
    } else if (candidate) {
      if (!pc.remoteDescription) {
        entry.pendingCandidates.push(candidate)
        return
      }
      try {
        await pc.addIceCandidate(candidate)
      } catch (e) {
        // 無視した offer に紐づく candidate は捨ててよい
        if (!entry.ignoreOffer) throw e
      }
    }
  }

  /** シグナルをピアごとに直列で処理する（並行実行すると setRemoteDescription と衝突する） */
  const enqueueSignal = (
    from: string,
    description?: RTCSessionDescriptionInit,
    candidate?: RTCIceCandidateInit | null,
  ) => {
    const entry = ensurePeer(from)
    if (!entry) return
    entry.queue = entry.queue
      .then(() => handleSignal(entry, from, description, candidate))
      // シグナリングの一時的な不整合は次のネゴシエーションで回復する
      .catch(() => {})
  }

  return {
    status: 'idle',
    errorMessage: null,
    participants: {},
    remoteStreams: {},
    localStream: null,
    muted: false,
    cameraOff: false,

    bindSender: (fn) => {
      sender = fn
    },

    join: async () => {
      const { status } = get()
      if (status === 'joining' || status === 'joined') return
      set({ status: 'joining', errorMessage: null })
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          // メッシュ接続なので低解像度をデフォルトに（帯域・CPU を抑える）
          video: { width: { ideal: 640 }, height: { ideal: 360 } },
        })
      } catch (e) {
        set({ status: 'error', errorMessage: mediaErrorMessage(e) })
        return
      }
      wantJoined = true
      set({ localStream: stream, muted: false, cameraOff: false })
      send('call.join', { muted: false, cameraOff: false })
    },

    leave: () => {
      wantJoined = false
      send('call.leave', {})
      closeAllPeers()
      get().localStream?.getTracks().forEach((t) => t.stop())
      set({
        status: 'idle',
        errorMessage: null,
        participants: {},
        remoteStreams: {},
        localStream: null,
        muted: false,
        cameraOff: false,
      })
    },

    toggleMute: () => {
      const { localStream, muted, cameraOff } = get()
      const next = !muted
      localStream?.getAudioTracks().forEach((t) => (t.enabled = !next))
      set({ muted: next })
      send('call.media', { muted: next, cameraOff })
    },

    toggleCamera: () => {
      const { localStream, muted, cameraOff } = get()
      const next = !cameraOff
      localStream?.getVideoTracks().forEach((t) => (t.enabled = !next))
      set({ cameraOff: next })
      send('call.media', { muted, cameraOff: next })
    },

    applyCallEvent: (ev) => {
      if (ev.type === 'call.joined') {
        // 参加確定。既存参加者ぶんの PeerConnection を張る
        set({ status: 'joined' })
        setParticipants(ev.payload.participants)
        syncPeers(ev.payload.participants)
      } else if (ev.type === 'call.participants') {
        setParticipants(ev.payload)
        if (get().localStream) syncPeers(ev.payload)
      } else if (ev.type === 'call.signal') {
        enqueueSignal(ev.payload.from, ev.payload.description, ev.payload.candidate)
      }
    },

    handleWsState: (state) => {
      if (!wantJoined) return
      if (state === 'closed') {
        // 再接続すると sessionId が変わるため、旧接続はすべて破棄して張り直す
        closeAllPeers()
      } else if (state === 'open') {
        const { muted, cameraOff } = get()
        send('call.join', { muted, cameraOff })
      }
    },
  }
})
