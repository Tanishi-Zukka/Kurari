import type { ServerEvent } from '@/types/model'

export type WsState = 'connecting' | 'open' | 'closed'

/** /ws に接続し、イベントと接続状態を通知する。切断時は自動再接続。 */
export function connectWs(
  onEvent: (ev: ServerEvent) => void,
  onState: (state: WsState) => void,
): () => void {
  let ws: WebSocket | null = null
  let closedByUser = false
  let retryTimer: number | undefined

  const open = () => {
    onState('connecting')
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/ws`)
    ws.onopen = () => onState('open')
    ws.onmessage = (e) => {
      try {
        onEvent(JSON.parse(e.data) as ServerEvent)
      } catch {
        // ignore malformed frames
      }
    }
    ws.onclose = () => {
      onState('closed')
      if (!closedByUser) {
        retryTimer = window.setTimeout(open, 2000)
      }
    }
  }
  open()

  return () => {
    closedByUser = true
    window.clearTimeout(retryTimer)
    ws?.close()
  }
}
