import { useState } from 'react'
import { Pause, Play, Square, Timer } from 'lucide-react'
import { useTimerStore } from '@/stores/timer-store'
import { cn } from '@/lib/utils'

function formatRemaining(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function TimerWidget() {
  const timer = useTimerStore((s) => s.timer)
  const remainingMs = useTimerStore((s) => s.remainingMs)
  const start = useTimerStore((s) => s.start)
  const pause = useTimerStore((s) => s.pause)
  const resume = useTimerStore((s) => s.resume)
  const stop = useTimerStore((s) => s.stop)
  const [open, setOpen] = useState(false)
  const [customMinutes, setCustomMinutes] = useState('')
  const idle = !timer || timer.phase === 'idle'
  const done = timer?.phase === 'running' && remainingMs === 0

  const begin = (minutes: number) => {
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 180) return
    start(minutes)
    setOpen(false)
  }

  return (
    <div className="relative">
      {idle ? (
        <button data-testid="timer-open" title="共有タイマー" onClick={() => setOpen((value) => !value)} className="flex h-8 w-8 items-center justify-center rounded-md border border-neutral-200 text-neutral-500 hover:bg-neutral-50"><Timer size={15} /></button>
      ) : (
        <button data-testid="timer-countdown" data-timer-done={done ? 'true' : undefined} onClick={() => setOpen((value) => !value)} className={cn('flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold tabular-nums', timer.phase === 'paused' ? 'bg-amber-100 text-amber-700' : 'bg-neutral-800 text-white', done && 'animate-pulse bg-red-600')}>
          <Timer size={13} />{formatRemaining(remainingMs)}
        </button>
      )}
      {open && (
        <div className="absolute left-1/2 top-10 z-[1400] w-56 -translate-x-1/2 rounded-lg border border-neutral-200 bg-white p-3 shadow-xl">
          {idle ? (
            <>
              <p className="mb-2 text-xs font-medium text-neutral-600">共有タイマー</p>
              <div className="mb-3 grid grid-cols-3 gap-1">
                {[1, 5, 10].map((minutes) => <button key={minutes} data-testid={`timer-preset-${minutes}`} onClick={() => begin(minutes)} className="rounded bg-neutral-100 py-1.5 text-xs text-neutral-700 hover:bg-neutral-200">{minutes}分</button>)}
              </div>
              <div className="flex gap-1.5">
                <input type="number" min={1} max={180} value={customMinutes} onChange={(event) => setCustomMinutes(event.target.value)} placeholder="分" className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-xs outline-none" />
                <button data-testid="timer-start" disabled={!customMinutes || Number(customMinutes) < 1 || Number(customMinutes) > 180} onClick={() => begin(Number(customMinutes))} className="rounded bg-neutral-800 px-2 py-1 text-xs text-white disabled:opacity-40">開始</button>
              </div>
            </>
          ) : (
            <>
              <p className="mb-1 text-center text-2xl font-semibold tabular-nums text-neutral-800">{formatRemaining(remainingMs)}</p>
              {timer.startedBy && <p className="mb-3 text-center text-[10px] text-neutral-400">{timer.startedBy}が開始</p>}
              <div className="flex justify-center gap-2">
                {timer.phase === 'running' ? <button data-testid="timer-pause" onClick={pause} className="flex items-center gap-1 rounded bg-amber-100 px-2 py-1 text-xs text-amber-700"><Pause size={12} />一時停止</button> : <button data-testid="timer-resume" onClick={resume} className="flex items-center gap-1 rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-700"><Play size={12} />再開</button>}
                <button data-testid="timer-stop" onClick={() => { stop(); setOpen(false) }} className="flex items-center gap-1 rounded bg-red-50 px-2 py-1 text-xs text-red-600"><Square size={11} />停止</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
