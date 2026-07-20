import { useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useAiJobStore } from '@/stores/ai-job-store'
import { useCallStore } from '@/stores/call-store'
import { parseAiJson, fallbackLines } from '@/lib/ai-json'
import { selectedRunnerId } from '@/lib/ai-run'
import { api } from '@/lib/api'

export function CallSummaryPanel() {
  const jobs = useAiJobStore((s) => s.jobs)
  const upsert = useAiJobStore((s) => s.upsert)
  const joinedAt = useCallStore((s) => s.joinedAt)
  const [manualJobId, setManualJobId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const relevant = useMemo(() => Object.values(jobs).filter((job) =>
    job.type === 'call_live_summary' && (!joinedAt || job.updatedAt >= joinedAt),
  ), [jobs, joinedAt])
  const latestDone = relevant.filter((job) => job.status === 'done').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  const updating = relevant.some((job) => job.status === 'pending' || job.status === 'claimed')
  const manualUpdating = !!manualJobId && ['pending', 'claimed'].includes(jobs[manualJobId]?.status ?? '')
  const points = useMemo(() => {
    const result = latestDone?.result ?? ''
    const parsed = parseAiJson<{ points: string[] }>(result)
    return Array.isArray(parsed?.points) ? parsed.points : fallbackLines(result)
  }, [latestDone])

  const refresh = async () => {
    const job = await api.triggerCallSummary({ runner: selectedRunnerId() })
    if (!job) {
      setNotice('新しい発言はありません')
      window.setTimeout(() => setNotice(null), 3000)
      return
    }
    upsert(job)
    setManualJobId(job.id)
  }

  return (
    <aside data-testid="call-summary-panel" className="w-80 shrink-0 overflow-y-auto border-l border-neutral-800 bg-neutral-900 p-4 text-neutral-200">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">ここまでの要点</h2>
        <button data-testid="call-summary-refresh" disabled={updating || manualUpdating} onClick={() => void refresh()} className="flex items-center gap-1 rounded-md bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700 disabled:opacity-50"><RefreshCw size={12} />今すぐ更新</button>
      </div>
      {(updating || manualUpdating) && <p data-testid="call-summary-updating" className="mb-3 text-xs text-neutral-400">要約を更新中…</p>}
      {notice && <p className="mb-3 text-xs text-amber-300">{notice}</p>}
      {points.length > 0 ? <ul className="list-disc space-y-2 pl-4 text-sm">{points.map((point, index) => <li key={`${point}-${index}`} data-testid="call-summary-point">{point}</li>)}</ul> : <p data-testid="call-summary-empty" className="text-xs text-neutral-500">まだ要約はありません</p>}
      {latestDone && <p data-testid="call-summary-updated-at" className="mt-4 text-[10px] text-neutral-500">最終更新 {new Date(latestDone.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>}
    </aside>
  )
}
