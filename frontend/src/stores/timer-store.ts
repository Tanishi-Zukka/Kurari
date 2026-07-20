import { create } from 'zustand'
import type { ServerEvent, TimerState } from '@/types/model'

interface TimerStoreState {
  timer: TimerState | null
  remainingMs: number
  bindSender: (send: (message: object) => void) => void
  applyTimerEvent: (event: Extract<ServerEvent, { type: 'timer.state' }>) => void
  start: (minutes: number) => void
  pause: () => void
  resume: () => void
  stop: () => void
}

let sender: ((message: object) => void) | null = null
let tickInterval: number | undefined

function clearTick() {
  if (tickInterval !== undefined) window.clearInterval(tickInterval)
  tickInterval = undefined
}

export const useTimerStore = create<TimerStoreState>((set, get) => ({
  timer: null,
  remainingMs: 0,
  bindSender: (send) => { sender = send },
  applyTimerEvent: (event) => {
    clearTick()
    const timer = event.payload
    const remainingMs = timer.phase === 'running' && timer.endsAt !== null
      ? Math.max(0, timer.endsAt - Date.now())
      : timer.remainingMs
    set({ timer, remainingMs })
    if (timer.phase === 'running' && timer.endsAt !== null) {
      tickInterval = window.setInterval(() => {
        const current = get().timer
        if (current?.phase !== 'running' || current.endsAt === null) return
        set({ remainingMs: Math.max(0, current.endsAt - Date.now()) })
      }, 500)
    }
  },
  start: (minutes) => sender?.({ type: 'timer.start', payload: { durationMs: minutes * 60_000 } }),
  pause: () => sender?.({ type: 'timer.pause', payload: {} }),
  resume: () => sender?.({ type: 'timer.resume', payload: {} }),
  stop: () => sender?.({ type: 'timer.stop', payload: {} }),
}))
