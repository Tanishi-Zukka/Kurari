import { api, type CreateAiJobRequest } from '@/lib/api'
import { useUiStore } from '@/stores/ui-store'
import type { AiJob } from '@/types/model'

/** ページ側で選択中の実行エンジンID。未選択・利用不可のときは undefined（Agent側の先頭にフォールバック） */
export function selectedRunnerId(): string | undefined {
  const { aiRunner, aiStatus } = useUiStore.getState()
  const available = aiStatus?.runners?.map((r) => r.id) ?? []
  if (aiRunner && available.includes(aiRunner)) return aiRunner
  return available[0]
}

/** 選択中の実行エンジンを付与してAIジョブを作成する。ジョブ作成は必ずこれを使う */
export function createAiJob(req: CreateAiJobRequest): Promise<AiJob> {
  return api.createAiJob({ ...req, runner: selectedRunnerId() })
}
