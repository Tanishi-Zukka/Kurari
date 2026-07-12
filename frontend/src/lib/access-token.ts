/**
 * アクセストークン（LAN 参加者用）の保管と 401 通知のハブ。
 * api.ts / ws.ts はこのモジュールだけを参照する（store への循環 import を避ける）。
 * オーナー（localhost）はトークン不要なので常に null のまま。
 */
const TOKEN_KEY = 'kurari.accessToken'
const REQUEST_KEY = 'kurari.joinRequestId'

export function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setAccessToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

/** 承認待ちの requestId（リロードしてもポーリングを再開できるように永続化） */
export function getJoinRequestId(): string | null {
  return localStorage.getItem(REQUEST_KEY)
}

export function setJoinRequestId(id: string | null) {
  if (id) localStorage.setItem(REQUEST_KEY, id)
  else localStorage.removeItem(REQUEST_KEY)
}

let unauthorizedCb: (() => void) | null = null

/** 401 を受けたときの処理（アクセスゲートへ落とす）を登録する。App が1回だけ呼ぶ */
export function onUnauthorized(cb: () => void) {
  unauthorizedCb = cb
}

export function notifyUnauthorized() {
  unauthorizedCb?.()
}
