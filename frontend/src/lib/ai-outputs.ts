import { useEntityStore } from '@/stores/entity-store'
import { ensureProjectGroup } from '@/lib/node-containers'
import { selectedRunnerId } from '@/lib/ai-run'
import type { AiSummaryData, KNode } from '@/types/model'

/**
 * AI出力をツリーに保存する。project 配下の「AI Outputs」グループを探し、
 * 無ければ作ってから ai_summary ノードを追加する。
 */
export async function saveAiOutput(input: {
  projectId: string
  name: string
  text: string
  sourceNodeId: string
  prompt?: string
}): Promise<KNode> {
  const { createNode } = useEntityStore.getState()
  const { group: outputs } = await ensureProjectGroup(input.projectId, 'AI Outputs')
  return createNode({
    parentId: outputs.id,
    type: 'ai_summary',
    name: input.name,
    data: {
      text: input.text,
      provider: selectedRunnerId() ?? 'mock',
      sourceNodeId: input.sourceNodeId,
      prompt: input.prompt ?? '',
    } satisfies AiSummaryData,
  })
}
