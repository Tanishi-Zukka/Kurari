import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type CreateAiJobRequest } from '@/lib/api'
import { createAiJob } from '@/lib/ai-run'
import { useAiJobStore } from '@/stores/ai-job-store'
import type { AiJob } from '@/types/model'

/**
 * AIジョブを1つ実行して完了まで追跡するフック。
 * 状態は WS(ai_job.updated) 経由の ai-job-store を優先し、
 * WSが使えない場合に備えて 1.5 秒ポーリングでフォールバックする。
 */
export function useAiJob() {
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const upsert = useAiJobStore((s) => s.upsert)
  const job: AiJob | null = useAiJobStore((s) => (jobId ? (s.jobs[jobId] ?? null) : null))
  const pollTimer = useRef<number | undefined>(undefined)

  const running = job !== null && (job.status === 'pending' || job.status === 'claimed')

  useEffect(() => {
    if (!running || !jobId) return
    pollTimer.current = window.setInterval(async () => {
      try {
        upsert(await api.getAiJob(jobId))
      } catch {
        // keep polling
      }
    }, 1500)
    return () => window.clearInterval(pollTimer.current)
  }, [running, jobId, upsert])

  const run = useCallback(
    async (req: CreateAiJobRequest) => {
      setError(null)
      try {
        const created = await createAiJob(req)
        upsert(created)
        setJobId(created.id)
        return created
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return null
      }
    },
    [upsert],
  )

  const reset = useCallback(() => {
    setJobId(null)
    setError(null)
  }, [])

  return { job, running, error, run, reset }
}
