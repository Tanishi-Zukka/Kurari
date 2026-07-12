import { useUiStore } from '@/stores/ui-store'
import { cn } from '@/lib/utils'

/**
 * AI実行エンジンのセレクタ。Agent がオンラインで複数エンジンを公開しているときだけ表示。
 * 選択はジョブ作成時に payload.runner として送られ、Agent がジョブごとに切り替える。
 */
export function RunnerSelect({ className }: { className?: string }) {
  const aiStatus = useUiStore((s) => s.aiStatus)
  const aiRunner = useUiStore((s) => s.aiRunner)
  const setAiRunner = useUiStore((s) => s.setAiRunner)

  const runners = aiStatus?.agent === 'online' ? (aiStatus.runners ?? []) : []
  if (runners.length === 0) return null

  const value = runners.some((r) => r.id === aiRunner) ? aiRunner! : runners[0].id

  return (
    <select
      className={cn(
        'h-6 rounded-md border border-neutral-300 bg-white px-1 text-[11px] text-neutral-700',
        'focus:outline-none focus:ring-2 focus:ring-neutral-400/40',
        className,
      )}
      value={value}
      onChange={(e) => setAiRunner(e.target.value)}
      title="AI実行エンジンを切り替え"
      data-testid="runner-select"
    >
      {runners.map((r) => (
        <option key={r.id} value={r.id}>
          {r.label}
        </option>
      ))}
    </select>
  )
}
