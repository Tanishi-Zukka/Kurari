import { useState } from 'react'
import { usePresenceStore } from '@/stores/presence-store'

/** 初回アクセス時に表示名を決めるモーダル。名前が未設定（空）の間だけ表示される */
export function PresenceNameDialog() {
  const name = usePresenceStore((s) => s.identity.name)
  const setName = usePresenceStore((s) => s.setName)
  const [value, setValue] = useState(() => `ゲスト${Math.floor(1000 + Math.random() * 9000)}`)

  if (name) return null

  const join = () => setName(value.trim() || 'ゲスト')

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/30"
      data-testid="presence-name-dialog"
    >
      <div className="w-80 rounded-xl bg-white p-5 shadow-xl">
        <div className="text-sm font-semibold text-neutral-800">表示名を設定</div>
        <p className="mt-1 text-xs text-neutral-500">
          他のメンバーにこの名前で表示されます。あとからヘッダーの自分のアイコンから変更できます。
        </p>
        <input
          autoFocus
          data-testid="presence-name-input"
          className="mt-3 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-500"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') join()
          }}
        />
        <button
          data-testid="presence-name-join"
          className="mt-3 w-full rounded bg-neutral-900 py-1.5 text-sm text-white hover:bg-neutral-700"
          onClick={join}
        >
          参加する
        </button>
      </div>
    </div>
  )
}
