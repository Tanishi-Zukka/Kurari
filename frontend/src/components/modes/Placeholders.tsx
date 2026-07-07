import type { ReactNode } from 'react'
import { Sparkles, Phone } from 'lucide-react'

function Placeholder({
  icon,
  title,
  description,
  bullets,
}: {
  icon: ReactNode
  title: string
  description: string
  bullets: string[]
}) {
  return (
    <div className="flex h-full items-center justify-center bg-neutral-50/50">
      <div className="max-w-md rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-500">
          {icon}
        </div>
        <div className="mb-1 flex items-center justify-center gap-2">
          <h2 className="text-base font-semibold text-neutral-800">{title}</h2>
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-500">
            Planned
          </span>
        </div>
        <p className="mb-4 text-sm text-neutral-500">{description}</p>
        <ul className="space-y-1 text-left text-xs text-neutral-400">
          {bullets.map((b) => (
            <li key={b}>・{b}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function AiModePlaceholder() {
  return (
    <Placeholder
      icon={<Sparkles size={18} />}
      title="AI Mode"
      description="プロジェクト全体を横断するAI分析画面。軽い操作は右のAIタブで今すぐ使えます。"
      bullets={[
        '新規参加者向けのプロジェクト説明',
        'ボード・ドキュメント・チャットの矛盾検出',
        '意思決定・未解決事項の抽出',
      ]}
    />
  )
}

export function CallPlaceholder() {
  return (
    <Placeholder
      icon={<Phone size={18} />}
      title="Call Mode"
      description="画面中央下にカメラ映像が並ぶ、対面感のある通話画面。通話メモとAI議事録が右パネルに紐づきます。"
      bullets={[
        '音声・カメラ通話 / 画面共有',
        '通話中のAIリアルタイム要約',
        '通話後の議事録の自動ドラフト',
      ]}
    />
  )
}
