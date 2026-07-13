import { useLocation, useNavigate } from 'react-router-dom'
import { Mic, MicOff, PhoneOff } from 'lucide-react'
import { useCallStore } from '@/stores/call-store'
import { cn } from '@/lib/utils'

/** 通話中に他モード（Board/Doc/AI）を開いているとき、通話継続を示すフローティングバー */
export function FloatingCallBar() {
  const status = useCallStore((s) => s.status)
  const participants = useCallStore((s) => s.participants)
  const muted = useCallStore((s) => s.muted)
  const toggleMute = useCallStore((s) => s.toggleMute)
  const leave = useCallStore((s) => s.leave)
  const { pathname } = useLocation()
  const navigate = useNavigate()

  if (status !== 'joined' || pathname.startsWith('/call')) return null

  return (
    <div
      data-testid="floating-call-bar"
      className="fixed bottom-10 right-4 z-50 flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-900/95 py-1.5 pl-3 pr-1.5 text-white shadow-lg"
    >
      <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
      <span className="text-xs">通話中 · {Object.keys(participants).length}人</span>
      <button
        onClick={toggleMute}
        title={muted ? 'ミュート解除' : 'ミュート'}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-full transition-colors',
          muted ? 'bg-red-600' : 'bg-neutral-700 hover:bg-neutral-600',
        )}
      >
        {muted ? <MicOff size={13} /> : <Mic size={13} />}
      </button>
      <button
        onClick={() => navigate('/call')}
        className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-medium transition-colors hover:bg-emerald-700"
      >
        通話に戻る
      </button>
      <button
        onClick={leave}
        title="通話から退出"
        className="flex h-7 w-7 items-center justify-center rounded-full bg-red-600 transition-colors hover:bg-red-700"
      >
        <PhoneOff size={13} />
      </button>
    </div>
  )
}
