import { useEffect } from 'react'
import { useAccessStore } from '@/stores/access-store'
import { UserPlus } from 'lucide-react'

/** オーナー専用: 参加リクエストの通知カード（右上に積む）。承認/拒否をその場で行う */
export function AccessRequestBanner() {
  const pending = useAccessStore((s) => s.pending)
  const approve = useAccessStore((s) => s.approve)
  const deny = useAccessStore((s) => s.deny)

  // 画面を開いた時点で溜まっている分も拾う（WS の access.requested は以後の分）
  useEffect(() => {
    void useAccessStore.getState().loadPending()
  }, [])

  if (pending.length === 0) return null

  return (
    <div className="fixed right-4 top-14 z-[1500] flex w-80 flex-col gap-2">
      {pending.map((p) => (
        <div
          key={p.requestId}
          data-testid="access-request-banner"
          className="rounded-lg border border-neutral-200 bg-white p-3 shadow-lg"
        >
          <div className="flex items-center gap-2 text-sm text-neutral-800">
            <UserPlus size={14} className="text-neutral-400" />
            <span className="font-medium">{p.name}</span>
            <span className="text-xs text-neutral-400">さんが参加をリクエスト</span>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              data-testid="access-approve"
              className="flex-1 rounded bg-neutral-900 py-1 text-xs text-white hover:bg-neutral-700"
              onClick={() => void approve(p.requestId)}
            >
              承認
            </button>
            <button
              data-testid="access-deny"
              className="flex-1 rounded border border-neutral-300 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
              onClick={() => void deny(p.requestId)}
            >
              拒否
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
