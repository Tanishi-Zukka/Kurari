import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui-store'

/** ボード右上の同期状態バッジ。StatusBar とは別に、ボード操作の文脈で常に見える位置に置く */
export function BoardSyncBadge() {
  const wsState = useUiStore((s) => s.wsState)

  const label = wsState === 'open' ? '同期中' : wsState === 'connecting' ? '接続中…' : 'オフライン'
  const dotClass =
    wsState === 'open' ? 'bg-emerald-500' : wsState === 'connecting' ? 'bg-amber-500' : 'bg-red-500'

  return (
    // 表示専用バッジ。ツールバーが広がって重なったときにクリックを奪わないよう pointer-events は切る
    <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[11px] text-neutral-600 shadow-sm">
      <span className={cn('h-1.5 w-1.5 rounded-full', dotClass)} />
      {label}
    </div>
  )
}
