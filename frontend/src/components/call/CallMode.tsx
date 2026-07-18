import { Fragment } from 'react'
import { Mic, MicOff, Monitor, MonitorOff, Phone, PhoneOff, Video, VideoOff } from 'lucide-react'
import type { StickyColor } from '@/types/model'
import { useCallStore } from '@/stores/call-store'
import { usePresenceStore } from '@/stores/presence-store'
import { STROKE_COLORS } from '@/components/board/BoardNodes'
import { cn } from '@/lib/utils'

/** ワークスペース通話（1ルーム）。参加中はタイルグリッド、離脱中は参加カードを表示 */
export function CallMode() {
  const status = useCallStore((s) => s.status)

  if (status !== 'joined') return <JoinCard />
  return (
    <div className="flex h-full flex-col bg-neutral-900">
      <TileGrid />
      <ControlBar />
    </div>
  )
}

/** 参加前の中央カード。通話中のメンバーがいれば名前を出す */
function JoinCard() {
  const status = useCallStore((s) => s.status)
  const errorMessage = useCallStore((s) => s.errorMessage)
  const participants = useCallStore((s) => s.participants)
  const join = useCallStore((s) => s.join)
  const peers = usePresenceStore((s) => s.peers)

  const inCallNames = Object.keys(participants)
    .map((sessionId) => peers[sessionId]?.name)
    .filter((n): n is string => !!n)

  return (
    <div className="flex h-full items-center justify-center bg-neutral-50/50">
      <div className="max-w-md rounded-xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-500">
          <Phone size={18} />
        </div>
        <h2 className="mb-1 text-base font-semibold text-neutral-800">Call Mode</h2>
        <p className="mb-4 text-sm text-neutral-500">
          {inCallNames.length > 0
            ? `${inCallNames.join('さん、')}さんが通話中です`
            : 'ワークスペースのメンバーと音声・カメラで通話できます。'}
        </p>
        {errorMessage && <p className="mb-3 text-sm text-red-600">{errorMessage}</p>}
        <button
          data-testid="call-join"
          disabled={status === 'joining'}
          onClick={() => void join()}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
        >
          <Phone size={14} />
          {status === 'joining' ? '接続中…' : '通話に参加'}
        </button>
      </div>
    </div>
  )
}

function TileGrid() {
  const participants = useCallStore((s) => s.participants)
  const remoteStreams = useCallStore((s) => s.remoteStreams)
  const localStream = useCallStore((s) => s.localStream)
  const screenStream = useCallStore((s) => s.screenStream)
  const muted = useCallStore((s) => s.muted)
  const cameraOff = useCallStore((s) => s.cameraOff)
  const peers = usePresenceStore((s) => s.peers)
  const identity = usePresenceStore((s) => s.identity)
  const selfSessionId = usePresenceStore((s) => s.selfSessionId)

  const others = Object.values(participants).filter((p) => p.sessionId !== selfSessionId)

  return (
    <div
      className="grid min-h-0 flex-1 content-center gap-3 overflow-y-auto p-4"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}
    >
      <CallTile
        testId="call-tile-self"
        name={`${identity.name}（自分）`}
        color={identity.color}
        stream={localStream}
        isSelf
        muted={muted}
        cameraOff={cameraOff}
      />
      {screenStream && (
        <ScreenTile name={identity.name} color={identity.color} stream={screenStream} />
      )}
      {others.map((p) => {
        const name = peers[p.sessionId]?.name ?? '接続中…'
        const color = peers[p.sessionId]?.color ?? 'gray'
        const streams = remoteStreams[p.sessionId]
        return (
          <Fragment key={p.sessionId}>
            <CallTile
              testId="call-tile"
              name={name}
              color={color}
              stream={findCameraStream(streams, p.screenStreamId)}
              muted={p.muted}
              cameraOff={p.cameraOff}
            />
            {p.screenStreamId && (
              <ScreenTile
                name={name}
                color={color}
                stream={streams?.[p.screenStreamId] ?? null}
              />
            )}
          </Fragment>
        )
      })}
    </div>
  )
}

/** 画面共有用ストリームを除外し、参加者のカメラストリームを解決する */
function findCameraStream(
  streams: Record<string, MediaStream> | undefined,
  screenStreamId: string | null,
): MediaStream | null {
  if (!streams) return null
  return Object.values(streams).find((stream) => stream.id !== screenStreamId) ?? null
}

function CallTile({
  testId,
  name,
  color,
  stream,
  isSelf = false,
  muted,
  cameraOff,
}: {
  testId: string
  name: string
  color: StickyColor
  stream: MediaStream | null
  isSelf?: boolean
  muted: boolean
  cameraOff: boolean
}) {
  const accent = STROKE_COLORS[color] ?? STROKE_COLORS.gray
  return (
    <div
      data-testid={testId}
      data-peer-name={name}
      data-muted={muted}
      className="relative aspect-video overflow-hidden rounded-xl bg-neutral-800"
    >
      {stream && !cameraOff ? (
        <video
          autoPlay
          playsInline
          // 自分の映像はミュート必須（エコー防止）+ 鏡像表示
          muted={isSelf}
          className={cn('h-full w-full object-cover', isSelf && '-scale-x-100')}
          ref={(el) => {
            // 再レンダーのたびに srcObject を再代入しない（再生が途切れるため）
            if (el && el.srcObject !== stream) {
              el.srcObject = stream
              el.play().catch(() => {})
            }
          }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-full text-xl font-semibold text-white"
            style={{ backgroundColor: accent }}
          >
            {(name || '?').slice(0, 1).toUpperCase()}
          </div>
        </div>
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-0.5 text-xs text-white">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: accent }} />
        {name}
        {muted && <MicOff size={12} className="text-red-400" />}
        {cameraOff && <VideoOff size={12} className="text-neutral-400" />}
      </div>
    </div>
  )
}

function ScreenTile({
  name,
  color,
  stream,
}: {
  name: string
  color: StickyColor
  stream: MediaStream | null
}) {
  const accent = STROKE_COLORS[color] ?? STROKE_COLORS.gray
  return (
    <div
      data-testid="call-tile-screen"
      data-peer-name={name}
      className="relative aspect-video overflow-hidden rounded-xl bg-neutral-950"
    >
      {stream ? (
        <video
          autoPlay
          playsInline
          muted
          className="h-full w-full object-contain"
          ref={(el) => {
            if (el && el.srcObject !== stream) {
              el.srcObject = stream
              el.play().catch(() => {})
            }
          }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-neutral-500">
          <Monitor size={32} />
        </div>
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-0.5 text-xs text-white">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: accent }} />
        {name}（画面）
      </div>
    </div>
  )
}

function ControlBar() {
  const muted = useCallStore((s) => s.muted)
  const cameraOff = useCallStore((s) => s.cameraOff)
  const screenStream = useCallStore((s) => s.screenStream)
  const transcribing = useCallStore((s) => s.transcribing)
  const errorMessage = useCallStore((s) => s.errorMessage)
  const toggleMute = useCallStore((s) => s.toggleMute)
  const toggleCamera = useCallStore((s) => s.toggleCamera)
  const startScreenShare = useCallStore((s) => s.startScreenShare)
  const stopScreenShare = useCallStore((s) => s.stopScreenShare)
  const leave = useCallStore((s) => s.leave)

  return (
    <div className="flex items-center justify-center gap-3 border-t border-neutral-800 py-3">
      {errorMessage && <span className="text-xs text-red-400">{errorMessage}</span>}
      {transcribing && (
        <span
          data-testid="call-transcribing"
          className="flex items-center gap-1.5 text-xs text-neutral-300"
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          文字起こし中
        </span>
      )}
      <button
        data-testid="call-mic"
        onClick={toggleMute}
        title={muted ? 'ミュート解除' : 'ミュート'}
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-full transition-colors',
          muted ? 'bg-red-600 text-white' : 'bg-neutral-700 text-white hover:bg-neutral-600',
        )}
      >
        {muted ? <MicOff size={17} /> : <Mic size={17} />}
      </button>
      <button
        data-testid="call-camera"
        onClick={toggleCamera}
        title={cameraOff ? 'カメラをオン' : 'カメラをオフ'}
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-full transition-colors',
          cameraOff ? 'bg-red-600 text-white' : 'bg-neutral-700 text-white hover:bg-neutral-600',
        )}
      >
        {cameraOff ? <VideoOff size={17} /> : <Video size={17} />}
      </button>
      <button
        data-testid="call-screen"
        onClick={() => (screenStream ? stopScreenShare() : void startScreenShare())}
        title={screenStream ? '共有を停止' : '画面を共有'}
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-full transition-colors',
          screenStream ? 'bg-red-600 text-white' : 'bg-neutral-700 text-white hover:bg-neutral-600',
        )}
      >
        {screenStream ? <MonitorOff size={17} /> : <Monitor size={17} />}
      </button>
      <button
        data-testid="call-leave"
        onClick={leave}
        title="通話から退出"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-red-600 text-white transition-colors hover:bg-red-700"
      >
        <PhoneOff size={17} />
      </button>
    </div>
  )
}
