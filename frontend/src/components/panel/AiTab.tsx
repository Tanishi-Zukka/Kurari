import { useCallback, useMemo, useState } from 'react'
import { useEntityStore } from '@/stores/entity-store'
import { useUiStore } from '@/stores/ui-store'
import { useHistoryStore } from '@/stores/history-store'
import { useAiJob } from '@/lib/use-ai-job'
import { saveAiOutput } from '@/lib/ai-outputs'
import { parseAiJson, fallbackLines } from '@/lib/ai-json'
import { bboxOf, gridBelowBoard } from '@/lib/board-layout'
import { stickyNameFrom } from '@/components/board/BoardNodes'
import { Button, Badge, Spinner, Textarea, Input } from '@/components/ui/primitives'
import { RunnerSelect } from '@/components/ui/RunnerSelect'
import { BOARD_ITEM_TYPES, type KNode } from '@/types/model'
import { Sparkles, Save, StickyNote, Lightbulb } from 'lucide-react'

/** AIが作った付箋群を1回のundoで消せるように history に積む */
function pushCreatedHistory(created: KNode[]) {
  const { removeNode, restoreNode } = useEntityStore.getState()
  useHistoryStore.getState().push({
    undo: async () => {
      for (const n of created) await removeNode(n.id)
    },
    redo: async () => {
      for (const n of created) await restoreNode(n)
    },
  })
}

export function AiTab() {
  const activeBoardId = useUiStore((s) => s.activeBoardId)
  const aiStatus = useUiStore((s) => s.aiStatus)
  const selectedIds = useUiStore((s) => s.selectedIds)
  const setSelected = useUiStore((s) => s.setSelected)
  const nodes = useEntityStore((s) => s.nodes)
  const createNode = useEntityStore((s) => s.createNode)

  const [prompt, setPrompt] = useState('')
  const [saved, setSaved] = useState(false)
  const { job, running, error, run } = useAiJob()

  // 選択要約（選択中のボード要素・セクションが対象）
  const selection = useMemo(
    () =>
      selectedIds.filter((id) => {
        const n = nodes[id]
        return n && (BOARD_ITEM_TYPES.includes(n.type) || n.type === 'section')
      }),
    [selectedIds, nodes],
  )
  const selJob = useAiJob()
  const [selPlaced, setSelPlaced] = useState(false)

  // ブレスト
  const [ideaPrompt, setIdeaPrompt] = useState('')
  const [ideaCount, setIdeaCount] = useState(5)
  const ideaJob = useAiJob()
  const [ideasPlaced, setIdeasPlaced] = useState(false)

  const summarize = useCallback(async () => {
    if (!activeBoardId) return
    setSaved(false)
    await run({
      type: 'summarize_board',
      targetId: activeBoardId,
      prompt: prompt.trim() || undefined,
    })
  }, [activeBoardId, prompt, run])

  const saveToTree = useCallback(async () => {
    if (!job?.result || !activeBoardId) return
    const board = nodes[activeBoardId]
    const projectId = board?.parentId
    if (!projectId) return
    const today = new Date()
    await saveAiOutput({
      projectId,
      name: `${today.getMonth() + 1}/${today.getDate()} ${board.name} 要約`,
      text: job.result,
      sourceNodeId: activeBoardId,
      prompt,
    })
    setSaved(true)
  }, [job, activeBoardId, nodes, prompt])

  const summarizeSelection = useCallback(async () => {
    if (selection.length === 0) return
    setSelPlaced(false)
    await selJob.run({ type: 'summarize_selection', nodeIds: selection })
  }, [selection, selJob])

  /** 選択要約の結果を、選択bboxの右横に付箋として配置 */
  const placeSelectionSticky = useCallback(async () => {
    const result = selJob.job?.result
    if (!result || !activeBoardId) return
    const snapshot = useEntityStore.getState().nodes
    const box = bboxOf(snapshot, selection)
    const pos = box ? { x: box.maxX + 60, y: box.minY } : { x: 100, y: 100 }
    const node = await createNode({
      parentId: activeBoardId,
      type: 'sticky',
      name: stickyNameFrom(result),
      data: {
        text: result,
        color: 'blue',
        aiGenerated: true,
        x: pos.x,
        y: pos.y,
        w: 260,
        h: 180,
      },
    })
    pushCreatedHistory([node])
    setSelected([node.id], { pan: true })
    setSelPlaced(true)
  }, [selJob.job, activeBoardId, selection, createNode, setSelected])

  const brainstorm = useCallback(async () => {
    if (!activeBoardId) return
    setIdeasPlaced(false)
    const n = Math.min(8, Math.max(3, ideaCount))
    await ideaJob.run({
      type: 'brainstorm',
      targetId: activeBoardId,
      prompt: `${ideaPrompt.trim() || 'このボードの内容を発展させるアイデア'}（${n}件）`,
    })
  }, [activeBoardId, ideaPrompt, ideaCount, ideaJob])

  /** ブレスト結果（JSON、失敗時は行分割）を既存要素の下に3列グリッドで配置 */
  const ideas = useMemo(() => {
    const result = ideaJob.job?.status === 'done' ? ideaJob.job.result : null
    if (!result) return []
    const parsed = parseAiJson<string[]>(result)
    const list = Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')
      ? parsed
      : fallbackLines(result)
    return list.filter((s) => s.trim().length > 0).slice(0, 12)
  }, [ideaJob.job])

  const placeIdeas = useCallback(async () => {
    if (ideas.length === 0 || !activeBoardId) return
    const snapshot = useEntityStore.getState().nodes
    const positions = gridBelowBoard(snapshot, activeBoardId, ideas.length)
    const created: KNode[] = []
    for (let i = 0; i < ideas.length; i++) {
      created.push(
        await createNode({
          parentId: activeBoardId,
          type: 'sticky',
          name: stickyNameFrom(ideas[i]),
          data: {
            text: ideas[i],
            color: 'blue',
            aiGenerated: true,
            x: positions[i].x,
            y: positions[i].y,
            w: 220,
            h: 180,
          },
        }),
      )
    }
    pushCreatedHistory(created)
    setSelected(created.map((n) => n.id), { pan: true })
    setIdeasPlaced(true)
  }, [ideas, activeBoardId, createNode, setSelected])

  if (!activeBoardId) {
    return <p className="p-4 text-xs text-neutral-400">ボードを開くとAI機能が使えます</p>
  }

  const statusBadge = (j: ReturnType<typeof useAiJob>['job']) =>
    j && (
      <Badge tone={j.status === 'done' ? 'green' : j.status === 'failed' ? 'red' : 'amber'}>
        {j.status}
      </Badge>
    )

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <div className="flex items-center gap-2">
        {aiStatus?.agent === 'online' ? (
          <>
            <Badge tone="green">Agent接続中</Badge>
            <RunnerSelect />
          </>
        ) : aiStatus?.mockMode ? (
          <Badge tone="amber">Agent未接続 → Mock応答</Badge>
        ) : (
          <Badge tone="red">Agent未接続</Badge>
        )}
      </div>

      {/* ボード要約 */}
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
          {statusBadge(job)}
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {job?.status === 'failed' && (
        <p className="text-xs text-red-600">失敗: {job.error ?? '不明なエラー'}</p>
      )}
      {job?.status === 'done' && job.result && (
        <>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-neutral-200 bg-neutral-50 p-3">
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

      {/* 選択要素の要約 → 付箋化 */}
      <div className="mt-1 border-t border-neutral-200 pt-3">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-neutral-600">
          <StickyNote size={12} />
          選択要素の要約
          {statusBadge(selJob.job)}
        </p>
        <Button
          size="sm"
          className="w-full"
          disabled={selection.length === 0 || selJob.running}
          onClick={() => void summarizeSelection()}
          title={selection.length === 0 ? 'ボード上の要素を選択してください' : undefined}
        >
          {selJob.running ? <Spinner /> : <Sparkles size={13} />}
          選択をAIで要約（{selection.length}件）
        </Button>
        {selJob.error && <p className="mt-1 text-xs text-red-600">{selJob.error}</p>}
        {selJob.job?.status === 'failed' && (
          <p className="mt-1 text-xs text-red-600">失敗: {selJob.job.error ?? '不明なエラー'}</p>
        )}
        {selJob.job?.status === 'done' && selJob.job.result && (
          <>
            <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-neutral-200 bg-neutral-50 p-2">
              <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-neutral-800">
                {selJob.job.result}
              </p>
            </div>
            <Button size="sm" className="mt-1.5 w-full" disabled={selPlaced} onClick={() => void placeSelectionSticky()}>
              <StickyNote size={13} />
              {selPlaced ? '配置済み' : '付箋として配置'}
            </Button>
          </>
        )}
      </div>

      {/* ブレスト（付箋の一括生成） */}
      <div className="mt-1 border-t border-neutral-200 pt-3">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-neutral-600">
          <Lightbulb size={12} />
          AIブレスト（付箋を生成）
          {statusBadge(ideaJob.job)}
        </p>
        <div className="flex items-center gap-1.5">
          <Input
            placeholder="テーマ 例: 新機能の案"
            value={ideaPrompt}
            onChange={(e) => setIdeaPrompt(e.target.value)}
          />
          <select
            className="h-8 shrink-0 rounded-md border border-neutral-300 bg-white px-1 text-sm text-neutral-700"
            value={ideaCount}
            onChange={(e) => setIdeaCount(Number(e.target.value))}
            title="生成する枚数"
          >
            {[3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>{n}枚</option>
            ))}
          </select>
        </div>
        <Button size="sm" className="mt-1.5 w-full" disabled={ideaJob.running} onClick={() => void brainstorm()}>
          {ideaJob.running ? <Spinner /> : <Lightbulb size={13} />}
          アイデアを生成
        </Button>
        {ideaJob.error && <p className="mt-1 text-xs text-red-600">{ideaJob.error}</p>}
        {ideaJob.job?.status === 'failed' && (
          <p className="mt-1 text-xs text-red-600">失敗: {ideaJob.job.error ?? '不明なエラー'}</p>
        )}
        {ideas.length > 0 && (
          <>
            <ul className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-neutral-200 bg-neutral-50 p-2 text-[12px] text-neutral-800">
              {ideas.map((idea, i) => (
                <li key={i} className="truncate">・{idea}</li>
              ))}
            </ul>
            <Button size="sm" className="mt-1.5 w-full" disabled={ideasPlaced} onClick={() => void placeIdeas()}>
              <StickyNote size={13} />
              {ideasPlaced ? '配置済み' : `ボードに配置（${ideas.length}枚）`}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
