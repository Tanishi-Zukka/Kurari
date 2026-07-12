import type { StickyColor } from '@/types/model'

/** このブラウザを識別するローカルアイデンティティ（ログイン概念の代替）。localStorage に永続化 */
export interface Identity {
  clientId: string
  name: string
  color: StickyColor
}

const KEY = 'kurari.identity'
const COLORS: StickyColor[] = ['yellow', 'blue', 'pink', 'green']

/** clientId から決定的に色を割り当てる（同じ人はいつも同じ色） */
function colorFor(clientId: string): StickyColor {
  let h = 0
  for (const ch of clientId) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return COLORS[h % COLORS.length]
}

/** 保存済みアイデンティティを読む。無ければ発番して保存（name は空 = 未設定で、初回モーダルを出す） */
export function loadIdentity(): Identity {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Identity>
      if (typeof parsed.clientId === 'string' && parsed.clientId) {
        return {
          clientId: parsed.clientId,
          name: typeof parsed.name === 'string' ? parsed.name : '',
          color: COLORS.includes(parsed.color as StickyColor)
            ? (parsed.color as StickyColor)
            : colorFor(parsed.clientId),
        }
      }
    }
  } catch {
    // 壊れた JSON は作り直す
  }
  const clientId = crypto.randomUUID()
  const identity: Identity = { clientId, name: '', color: colorFor(clientId) }
  localStorage.setItem(KEY, JSON.stringify(identity))
  return identity
}

export function saveIdentity(identity: Identity) {
  localStorage.setItem(KEY, JSON.stringify(identity))
}
