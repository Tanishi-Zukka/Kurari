import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { childrenOf, useEntityStore } from '@/stores/entity-store'
import { useUiStore } from '@/stores/ui-store'
import { Button, Badge, Spinner, Textarea } from '@/components/ui/primitives'
import type { AiJob, AiSummaryData } from '@/types/model'
import { Sparkles, Save } from 'lucide-react'

export function AiTab() {
  const activeBoardId = useUiStore((s) => s.activeBoardId)
  const aiStatus = useUiStore((s) => s.aiStatus)
  const nodes = useEntityStore((s) => s.nodes)
  const createNode = useEntityStore((s) => s.createNode)

  const [prompt, setPrompt] = useState('')
  const [job, setJob] = useState<AiJob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const pollTimer = useRef<number | undefined>(undefined)

  const running = job !== null && (job.status === 'pending' || job.status === 'claimed')

  // WS が使えない場合に備えたポーリング（ai_job.updated はWSでも来る）
  useEffect(() => {
    if (!running || !job) return
    pollTimer.current = window.setInterval(async () => {
      try {
        const latest = await api.getAiJob(job.id)
        setJob(latest)
      } catch {
        // keep polling
      }
    }, 1500)
    return () => window.clearInterval(pollTimer.current)
  }, [running, job?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const summarize = useCallback(async () => {
    if (!activeBoardId) return
    setError(null)
    setSaved(false)
    try {
      const created = await api.createAiJob({
        type: 'summarize_board',
        boardId: activeBoardId,
        prompt: prompt.trim() || undefined,
      })
      setJob(created)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [activeBoardId, prompt])

  const saveToTree = useCallback(async () => {
    if (!job?.result || !activeBoardId) return
    const board = nodes[activeBoardId]
    const projectId = board?.parentId
    if (!projectId) return

    // Project 配下の「AI Outputs」グループを探し、無ければ作る
    let outputs = childrenOf(nodes, projectId).find(
      (n) => n.type === 'group' && n.name === 'AI Outputs',
    )
    if (!outputs) {
      outputs = await createNode({ parentId: projectId, type: 'group', name: 'AI Outputs' })
    }
    const today = new Date()
    await createNode({
      parentId: outputs.id,
      type: 'ai_summary',
      name: `${today.getMonth() + 1}/${today.getDate()} ${board.name} 要約`,
      data: {
        text: job.result,
        provider: 'copilot-cli',
        sourceNodeId: activeBoardId,
        prompt: prompt,
      } satisfies AiSummaryData,
    })
    setSaved(true)
  }, [job, activeBoardId, nodes, createNode, prompt])

  if (!activeBoardId) {
    return <p className="p-4 text-xs text-neutral-400">ボードを開くとAI要約が使えます</p>
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        {aiStatus?.agent === 'online' ? (
          <Badge tone="green">Agent接続中 (copilot)</Badge>
        ) : aiStatus?.mockMode ? (
          <Badge tone="amber">Agent未接続 → Mock応答</Badge>
        ) : (
          <Badge tone="red">Agent未接続</Badge>
        )}
      </div>

      <Textarea
        rows={2}
        placeholder="追加の指示（任意）例: 決定事項と未決事項に分けて"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />

      <Button variant="primary" disabled={running} onClick={() => void summarize()}>
        {running ? <Spinner /> : <Sparkles size={14} />}
        このボードを要約
      </Button>

      {job && (
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span>status:</span>
          <Badge
            tone={job.status === 'done' ? 'green' : job.status === 'failed' ? 'red' : 'amber'}
          >
            {job.status}
          </Badge>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
      {job?.status === 'failed' && (
        <p className="text-xs text-red-600">失敗: {job.error ?? '不明なエラー'}</p>
      )}

      {job?.status === 'done' && job.result && (
        <>
          <div className="flex-1 overflow-y-auto rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-800">
              {job.result}
            </p>
          </div>
          <Button disabled={saved} onClick={() => void saveToTree()}>
            <Save size={14} />
            {saved ? '保存済み（ツリーのAI Outputsへ）' : 'ツリーに保存'}
          </Button>
        </>
      )}
    </div>
  )
}
