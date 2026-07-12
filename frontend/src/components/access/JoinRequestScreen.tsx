import { useEffect, useState } from 'react'
import { useAccessStore } from '@/stores/access-store'
import { loadIdentity } from '@/lib/identity'
import { Lock } from 'lucide-react'

/** 未承認クライアント（LAN 参加者）向けの参加リクエスト画面。承認されるまでアプリ本体は描画しない */
export function JoinRequestScreen() {
  const joinState = useAccessStore((s) => s.joinState)
  const requestJoin = useAccessStore((s) => s.requestJoin)
  const [name, setName] = useState(() => loadIdentity().name)
  const hasInvite = new URLSearchParams(location.search).has('invite')

  // リロードしても承認待ちを継続する
  useEffect(() => {
    useAccessStore.getState().resumePolling()
  }, [])

  const submit = () => void requestJoin(name)

  return (
    <div className="flex h-screen items-center justify-center bg-neutral-50">
      <div className="w-96 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
          <Lock size={14} className="text-neutral-400" />
          Kurari に参加
        </div>

        {joinState.phase === 'waiting' ? (
          <div className="mt-4" data-testid="join-waiting">
            <p className="text-sm text-neutral-600">オーナーの承認を待っています…</p>
            <p className="mt-1 text-xs text-neutral-400">
              承認されると自動的にワークスペースが開きます。この画面のまま待つか、閉じて後で開き直しても構いません。
            </p>
          </div>
        ) : joinState.phase === 'denied' ? (
          <div className="mt-4" data-testid="join-denied">
            <p className="text-sm text-red-600">参加リクエストは承認されませんでした。</p>
            <button
              className="mt-3 w-full rounded bg-neutral-900 py-1.5 text-sm text-white hover:bg-neutral-700"
              onClick={submit}
            >
              もう一度リクエストする
            </button>
          </div>
        ) : !hasInvite ? (
          <p className="mt-4 text-sm text-neutral-600" data-testid="join-no-invite">
            このワークスペースを開くには招待リンクが必要です。オーナーに招待リンクを発行してもらってください。
          </p>
        ) : (
          <div className="mt-4">
            <p className="text-xs text-neutral-500">
              表示名を入力して参加をリクエストします。オーナーが承認すると入れます。
            </p>
            <input
              autoFocus
              data-testid="join-name-input"
              placeholder="表示名"
              className="mt-3 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
            />
            {joinState.phase === 'error' && (
              <p className="mt-2 text-xs text-red-600">{joinState.message}</p>
            )}
            <button
              data-testid="join-submit"
              disabled={joinState.phase === 'requesting'}
              className="mt-3 w-full rounded bg-neutral-900 py-1.5 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
              onClick={submit}
            >
              {joinState.phase === 'requesting' ? '送信中…' : '参加をリクエスト'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
