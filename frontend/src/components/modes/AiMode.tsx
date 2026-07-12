import { useMemo } from 'react'
import { childrenOf, useEntityStore } from '@/stores/entity-store'
import { useUiStore } from '@/stores/ui-store'
import { saveAiOutput } from '@/lib/ai-outputs'
import { parseAiJson } from '@/lib/ai-json'
import { AnalysisCard } from './AnalysisCard'
import { ChatView } from '@/components/chat/ChatView'
import { Badge } from '@/components/ui/primitives'
import { RunnerSelect } from '@/components/ui/RunnerSelect'
import { BookOpen, GitCompareArrows, ListChecks, Sparkles } from 'lucide-react'

interface Conflict {
  topic: string
  a: string
  b: string
  hint?: string
}

interface Decisions {
  decisions: string[]
  openQuestions: string[]
}

/** AI Mode: プロジェクト全体を横断するAI分析 + プロジェクトAIチャット */
export function AiMode() {
  const nodes = useEntityStore((s) => s.nodes)
  const createNode = useEntityStore((s) => s.createNode)
  const aiStatus = useUiStore((s) => s.aiStatus)

  // 現状は単一プロジェクト前提
  const project = useMemo(
    () => Object.values(nodes).find((n) => n.type === 'project') ?? null,
    [nodes],
  )

  if (!project) {
    return <p className="p-6 text-sm text-neutral-400">プロジェクトが見つかりません</p>
  }

  const today = new Date()
  const dateLabel = `${today.getMonth() + 1}/${today.getDate()}`

  /** decisions / openQuestions を「意思決定ログ」グループ配下のノードとして保存 */
  const saveDecisions = async (result: string) => {
    const parsed = parseAiJson<Decisions>(result)
    if (!parsed) {
      // パースできなければテキストのまま ai_summary として保存
      await saveAiOutput({
        projectId: project.id,
        name: `${dateLabel} 意思決定と未解決事項`,
        text: result,
        sourceNodeId: project.id,
      })
      return
    }
    const current = useEntityStore.getState().nodes
    let group = childrenOf(current, project.id).find(
      (n) => n.type === 'group' && n.name === '意思決定ログ',
    )
    if (!group) {
      group = await createNode({ parentId: project.id, type: 'group', name: '意思決定ログ' })
    }
    for (const d of parsed.decisions ?? []) {
      await createNode({ parentId: group.id, type: 'decision', name: d.slice(0, 60), data: { text: d } })
    }
    for (const q of parsed.openQuestions ?? []) {
      await createNode({ parentId: group.id, type: 'open_question', name: q.slice(0, 60), data: { text: q } })
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-50/50">
      <div className="flex items-center gap-2 border-b border-neutral-200 bg-white px-4 py-2.5">
        <Sparkles size={15} className="text-neutral-600" />
        <span className="text-sm font-semibold text-neutral-800">AI Mode</span>
        <span className="text-xs text-neutral-400">— {project.name}</span>
        <span className="ml-auto flex items-center gap-2">
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
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(300px,1fr))]">
            <AnalysisCard
              icon={<BookOpen size={14} />}
              title="プロジェクト説明"
              description="新規参加者向けに、目的・現状・主要な論点をまとめます"
              runLabel="説明を生成"
              onRun={(run) => run({ type: 'project_brief', targetId: project.id })}
              renderResult={(result) => (
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-800">
                  {result}
                </p>
              )}
              onSave={(result) =>
                saveAiOutput({
                  projectId: project.id,
                  name: `${dateLabel} プロジェクト説明`,
                  text: result,
                  sourceNodeId: project.id,
                }).then(() => undefined)
              }
            />

            <AnalysisCard
              icon={<GitCompareArrows size={14} />}
              title="矛盾検出"
              description="ボード・ドキュメント・チャットの間の食い違いを検出します"
              runLabel="矛盾を検出"
              onRun={(run) => run({ type: 'detect_conflicts', targetId: project.id })}
              renderResult={(result) => {
                const conflicts = parseAiJson<Conflict[]>(result)
                if (!conflicts) {
                  return (
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-800">
                      {result}
                    </p>
                  )
                }
                if (conflicts.length === 0) {
                  return <p className="text-[13px] text-neutral-500">矛盾は見つかりませんでした</p>
                }
                return (
                  <ul className="flex flex-col gap-2">
                    {conflicts.map((c, i) => (
                      <li key={i} className="rounded-md border border-red-200 bg-red-50/60 p-2">
                        <p className="text-xs font-semibold text-red-800">{c.topic}</p>
                        <p className="mt-1 text-[12px] text-neutral-700">A: {c.a}</p>
                        <p className="text-[12px] text-neutral-700">B: {c.b}</p>
                        {c.hint && <p className="mt-1 text-[12px] text-neutral-500">💡 {c.hint}</p>}
                      </li>
                    ))}
                  </ul>
                )
              }}
              onSave={(result) => {
                const conflicts = parseAiJson<Conflict[]>(result)
                const text = conflicts
                  ? conflicts
                      .map((c) => `## ${c.topic}\n- A: ${c.a}\n- B: ${c.b}${c.hint ? `\n- ヒント: ${c.hint}` : ''}`)
                      .join('\n\n') || '矛盾なし'
                  : result
                return saveAiOutput({
                  projectId: project.id,
                  name: `${dateLabel} 矛盾検出`,
                  text,
                  sourceNodeId: project.id,
                }).then(() => undefined)
              }}
            />

            <AnalysisCard
              icon={<ListChecks size={14} />}
              title="意思決定・未解決事項"
              description="確定した決定と、まだ答えの出ていない事項を抽出します"
              runLabel="抽出する"
              onRun={(run) => run({ type: 'extract_decisions', targetId: project.id })}
              renderResult={(result) => {
                const parsed = parseAiJson<Decisions>(result)
                if (!parsed) {
                  return (
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-800">
                      {result}
                    </p>
                  )
                }
                return (
                  <div className="flex flex-col gap-2 text-[13px]">
                    <div>
                      <p className="mb-1 text-xs font-semibold text-emerald-700">決定事項</p>
                      {(parsed.decisions ?? []).length === 0 && (
                        <p className="text-neutral-400">なし</p>
                      )}
                      <ul className="list-inside list-disc text-neutral-800">
                        {(parsed.decisions ?? []).map((d, i) => <li key={i}>{d}</li>)}
                      </ul>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-semibold text-amber-700">未解決事項</p>
                      {(parsed.openQuestions ?? []).length === 0 && (
                        <p className="text-neutral-400">なし</p>
                      )}
                      <ul className="list-inside list-disc text-neutral-800">
                        {(parsed.openQuestions ?? []).map((q, i) => <li key={i}>{q}</li>)}
                      </ul>
                    </div>
                  </div>
                )
              }}
              onSave={saveDecisions}
              saveLabel="意思決定ログに保存"
            />
          </div>
        </div>

        <div className="flex w-80 shrink-0 flex-col border-l border-neutral-200 bg-white">
          <div className="border-b border-neutral-100 px-3 py-2 text-xs font-medium text-neutral-500">
            プロジェクトAIチャット
          </div>
          <div className="min-h-0 flex-1">
            <ChatView contextTargetId={project.id} />
          </div>
        </div>
      </div>
    </div>
  )
}
