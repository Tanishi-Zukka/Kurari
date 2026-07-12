import { useState } from 'react'
import { useAccessStore } from '@/stores/access-store'
import { Button } from '@/components/ui/primitives'
import { UserPlus, Copy, Check } from 'lucide-react'

/** オーナー専用: 招待リンクの発行・コピー（再発行すると古いリンクは失効する） */
export function InviteButton() {
  const inviteUrl = useAccessStore((s) => s.inviteUrl)
  const issueInvite = useAccessStore((s) => s.issueInvite)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const openPanel = async () => {
    if (!open && !inviteUrl) await issueInvite()
    setOpen((v) => !v)
    setCopied(false)
  }

  const copy = async () => {
    if (!inviteUrl) return
    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="relative">
      <Button variant="ghost" size="icon" title="LANのメンバーを招待" onClick={() => void openPanel()}>
        <UserPlus size={15} />
      </Button>
      {open && (
        <div className="absolute right-0 top-9 z-[1300] w-80 rounded-lg border border-neutral-200 bg-white p-3 shadow-lg">
          <div className="text-xs font-medium text-neutral-600">招待リンク</div>
          <p className="mt-1 text-[11px] text-neutral-400">
            同じネットワークの相手に渡してください。開いた人が参加をリクエストし、あなたが承認すると入れます（有効期限1時間・再発行で失効）。
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            <input
              readOnly
              data-testid="invite-url"
              className="min-w-0 flex-1 rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-[11px] text-neutral-700"
              value={inviteUrl ?? ''}
              onFocus={(e) => e.target.select()}
            />
            <Button variant="ghost" size="icon" title="コピー" onClick={() => void copy()}>
              {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
            </Button>
          </div>
          <button
            className="mt-2 text-[11px] text-neutral-400 underline hover:text-neutral-600"
            onClick={() => void issueInvite()}
          >
            新しいリンクを再発行（古いリンクを無効化）
          </button>
        </div>
      )}
    </div>
  )
}
