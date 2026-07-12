import { useCallback, useState, type ReactNode } from 'react'
import { useAiJob } from '@/lib/use-ai-job'
import { Badge, Button, Spinner } from '@/components/ui/primitives'
import type { AiJob } from '@/types/model'
import { Save } from 'lucide-react'

/**
 * AI Mode の分析カード1枚。実行 → 結果表示 → ツリー保存 の共通枠。
 * 結果の描画（JSONの構造表示など）と保存処理は呼び出し側が差し込む。
 */
export function AnalysisCard({
  icon,
  title,
  description,
  runLabel,
  onRun,
  renderResult,
  onSave,
  saveLabel = 'ツリーに保存',
}: {
  icon: ReactNode
  title: string
  description: string
  runLabel: string
  /** useAiJob.run を呼ぶ。null を返すと未実行扱い */
  onRun: (run: ReturnType<typeof useAiJob>['run']) => Promise<AiJob | null>
  renderResult: (result: string) => ReactNode
  onSave?: (result: string) => Promise<void>
  saveLabel?: string
}) {
  const { job, running, error, run } = useAiJob()
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleRun = useCallback(async () => {
    setSaved(false)
    await onRun(run)
  }, [onRun, run])

  const handleSave = useCallback(async () => {
    if (!job?.result || !onSave) return
    setSaving(true)
    try {
      await onSave(job.result)
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }, [job, onSave])

  return (
    <div className="flex flex-col rounded-xl border border-neutral-200 bg-white p-4">
      <div className="mb-1 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-100 text-neutral-600">
          {icon}
        </span>
        <h3 className="text-sm font-semibold text-neutral-800">{title}</h3>
        {job && (
          <Badge
            className="ml-auto"
            tone={job.status === 'done' ? 'green' : job.status === 'failed' ? 'red' : 'amber'}
          >
            {job.status}
          </Badge>
        )}
      </div>
      <p className="mb-3 text-xs text-neutral-500">{description}</p>

      <Button variant="primary" size="sm" disabled={running} onClick={() => void handleRun()}>
        {running ? <Spinner /> : null}
        {runLabel}
      </Button>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {job?.status === 'failed' && (
        <p className="mt-2 text-xs text-red-600">失敗: {job.error ?? '不明なエラー'}</p>
      )}

      {job?.status === 'done' && job.result && (
        <>
          <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            {renderResult(job.result)}
          </div>
          {onSave && (
            <Button className="mt-2" size="sm" disabled={saved || saving} onClick={() => void handleSave()}>
              <Save size={13} />
              {saved ? '保存済み' : saveLabel}
            </Button>
          )}
        </>
      )}
    </div>
  )
}
