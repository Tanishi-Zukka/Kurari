import type { ServerEvent } from '@/types/model'
import { getAccessToken } from '@/lib/access-token'

export type WsState = 'connecting' | 'open' | 'closed'

export interface WsConnection {
  close: () => void
  /** 接続中のみ送信する（未接続時は黙って捨てる。プレゼンス用途なので損失許容） */
  send: (msg: object) => void
}

/** /ws に接続し、イベントと接続状態を通知する。切断時は自動再接続。 */
export function connectWs(
  onEvent: (ev: ServerEvent) => void,
  onState: (state: WsState) => void,
): WsConnection {
  let ws: WebSocket | null = null
  let closedByUser = false
  let retryTimer: number | undefined

  const open = () => {
    onState('connecting')
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    // 再接続のたびに読み直す（承認直後の接続にも自然に対応）。オーナーは token なし
    const token = getAccessToken()
    ws = new WebSocket(
      `${proto}://${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`,
    )
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

  return {
    close: () => {
      closedByUser = true
      window.clearTimeout(retryTimer)
      ws?.close()
    },
    send: (msg) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
    },
  }
}
