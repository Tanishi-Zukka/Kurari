import { create } from 'zustand'
import type { ServerEvent, StickyColor } from '@/types/model'

export interface ReactionPing {
  id: string
  emoji: string
  x: number
  y: number
  boardId: string
  name: string
  color: StickyColor
}

interface ReactionState {
  pings: ReactionPing[]
  bindSender: (send: (msg: object) => void) => void
  receive: (payload: Extract<ServerEvent, { type: 'reaction.ping' }>['payload']) => void
  sendPing: (emoji: string, x: number, y: number, boardId: string) => void
}

let sender: ((msg: object) => void) | null = null
let lastSentAt = 0

export const useReactionStore = create<ReactionState>((set) => ({
  pings: [],
  bindSender: (send) => { sender = send },
  receive: (payload) => {
    const id = crypto.randomUUID()
    set((state) => ({ pings: [...state.pings.slice(-49), { id, ...payload }] }))
    window.setTimeout(() => set((state) => ({ pings: state.pings.filter((ping) => ping.id !== id) })), 1600)
  },
  sendPing: (emoji, x, y, boardId) => {
    const now = performance.now()
    if (now - lastSentAt < 100) return
    lastSentAt = now
    sender?.({ type: 'reaction.ping', payload: { emoji, x, y, boardId } })
  },
}))
