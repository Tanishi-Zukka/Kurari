import { create } from 'zustand'
import type { AiJob } from '@/types/model'

/**
 * AIジョブの最新状態。WS の ai_job.updated と useAiJob のポーリングの両方から
 * upsert され、購読側（useAiJob / チャットの「考え中」表示）はここだけを見る。
 */
interface AiJobState {
  jobs: Record<string, AiJob>
  upsert: (job: AiJob) => void
}

export const useAiJobStore = create<AiJobState>((set) => ({
  jobs: {},
  upsert: (job) =>
    set((s) => {
      const current = s.jobs[job.id]
      // 古いイベントで新しい状態を巻き戻さない
      if (current && current.updatedAt > job.updatedAt) return s
      return { jobs: { ...s.jobs, [job.id]: job } }
    }),
}))
