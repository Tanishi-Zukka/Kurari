import { useCallback, useEffect, useState } from 'react'
import { useEntityStore } from '@/stores/entity-store'
import { useAiJob } from '@/lib/use-ai-job'
import { saveAiOutput } from '@/lib/ai-outputs'
import { DocRecorder } from './DocRecorder'
import { Badge, Button, Input, Spinner } from '@/components/ui/primitives'
import { ListPlus, PenLine, Save, Sparkles, TextQuote } from 'lucide-react'

/**
 * BlockNote エディタのうちツールバーが使う操作だけの構造的インターフェース。
 * （カスタムスキーマ入りの BlockNoteEditor 型をそのまま引き回さないため）
 */
export interface DocEditorHandle {
  document: Array<{ id: string }>
  tryParseMarkdownToBlocks(markdown: string): unknown[]
  insertBlocks(blocks: unknown[], referenceBlock: unknown, placement: 'before' | 'after'): void
  getTextCursorPosition(): { block: { id: string } }
}

type InsertWhere = 'cursor' | 'end'

/** ドキュメントのAI操作列: 下書き / 続き / 要約 / 録音メモ */
export function DocAiToolbar({
  docId,
  editor,
  doSave,
}: {
  docId: string
  editor: DocEditorHandle
  doSave: () => Promise<void>
}) {
  const doc = useEntityStore((s) => s.nodes[docId])

  const insertMarkdown = useCallback(
    (markdown: string, where: InsertWhere) => {
      const blocks = editor.tryParseMarkdownToBlocks(markdown)
      if (blocks.length === 0) return
      const ref =
        where === 'end'
          ? editor.document[editor.document.length - 1]
          : editor.getTextCursorPosition().block
      editor.insertBlocks(blocks, ref, 'after')
      void doSave()
    },
    [editor, doSave],
  )

  // --- AI下書き / 続きを生成（done になったら本文へ挿入） ---
  // pending はジョブIDと紐づける。where だけだと、前回の done ジョブが
  // ストアに残ったまま次を実行した瞬間に古い結果を再挿入してしまう。
  const draftJob = useAiJob()
  const [pendingInsert, setPendingInsert] = useState<{ jobId: string; where: InsertWhere } | null>(null)
  const [showDraftInput, setShowDraftInput] = useState(false)
  const [draftPrompt, setDraftPrompt] = useState('')

  useEffect(() => {
    if (!pendingInsert || draftJob.job?.id !== pendingInsert.jobId) return
    if (draftJob.job.status === 'done' && draftJob.job.result) {
      insertMarkdown(draftJob.job.result, pendingInsert.where)
      setPendingInsert(null)
    } else if (draftJob.job.status === 'failed') {
      setPendingInsert(null)
    }
  }, [draftJob.job, pendingInsert, insertMarkdown])

  const runDraft = useCallback(async () => {
    const p = draftPrompt.trim()
    if (!p) return
    setShowDraftInput(false)
    const created = await draftJob.run({ type: 'draft_document', targetId: docId, prompt: p })
    if (created) setPendingInsert({ jobId: created.id, where: 'cursor' })
  }, [draftPrompt, draftJob, docId])

  const runContinue = useCallback(async () => {
    const created = await draftJob.run({
      type: 'draft_document',
      targetId: docId,
      prompt: '既存本文の自然な続きを書いてください',
    })
    if (created) setPendingInsert({ jobId: created.id, where: 'end' })
  }, [draftJob, docId])

  // --- ドキュメント要約 ---
  const sumJob = useAiJob()
  const [sumSaved, setSumSaved] = useState(false)

  const runSummary = useCallback(async () => {
    setSumSaved(false)
    await sumJob.run({ type: 'summarize_document', targetId: docId })
  }, [sumJob, docId])

  const saveSummary = useCallback(async () => {
    const result = sumJob.job?.result
    if (!result || !doc?.parentId) return
    const today = new Date()
    await saveAiOutput({
      projectId: doc.parentId,
      name: `${today.getMonth() + 1}/${today.getDate()} ${doc.name} 要約`,
      text: result,
      sourceNodeId: docId,
    })
    setSumSaved(true)
  }, [sumJob.job, doc, docId])

  // --- 録音メモ（音声ブロック + 文字起こし + AI要約） ---
  const recJob = useAiJob()
  const [recPending, setRecPending] = useState<string | null>(null) // 待機中のジョブID

  useEffect(() => {
    if (!recPending || recJob.job?.id !== recPending) return
    if (recJob.job.status === 'done' && recJob.job.result) {
      insertMarkdown(`**AI要約（録音）**\n\n${recJob.job.result}`, 'end')
      setRecPending(null)
    } else if (recJob.job.status === 'failed') {
      setRecPending(null)
    }
  }, [recJob.job, recPending, insertMarkdown])

  const onRecordFinish = useCallback(
    (audioUrl: string | null, transcript: string) => {
      const now = new Date()
      const label = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      const blocks: unknown[] = [
        { type: 'heading', props: { level: 3 }, content: `録音メモ ${label}` },
      ]
      if (audioUrl) blocks.push({ type: 'audio', props: { url: audioUrl } })
      blocks.push({
        type: 'paragraph',
        content: transcript || '(文字起こしなし)',
      })
      const ref = editor.document[editor.document.length - 1]
      editor.insertBlocks(blocks, ref, 'after')
      void doSave()
      if (transcript) {
        void recJob.run({ type: 'summarize_transcript', sourceText: transcript }).then((created) => {
          if (created) setRecPending(created.id)
        })
      }
    },
    [editor, doSave, recJob],
  )

  const busy = draftJob.running || recJob.running
  const jobError =
    draftJob.error ??
    sumJob.error ??
    recJob.error ??
    (draftJob.job?.status === 'failed' ? draftJob.job.error : null) ??
    (sumJob.job?.status === 'failed' ? sumJob.job.error : null) ??
    (recJob.job?.status === 'failed' ? recJob.job.error : null)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => setShowDraftInput((v) => !v)}
          title="指示からMarkdownの下書きを生成してカーソル位置に挿入"
        >
          <PenLine size={13} />
          AI下書き
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void runContinue()}
          title="本文の続きを生成して文末に挿入"
        >
          {draftJob.running && pendingInsert?.where === 'end' ? <Spinner /> : <ListPlus size={13} />}
          続きを生成
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={sumJob.running}
          onClick={() => void runSummary()}
          title="このドキュメントを要約"
        >
          {sumJob.running ? <Spinner /> : <TextQuote size={13} />}
          要約
        </Button>
        <DocRecorder onFinish={onRecordFinish} />
        {draftJob.running && (
          <span className="flex items-center gap-1 text-xs text-neutral-400">
            <Sparkles size={11} /> 生成中…
          </span>
        )}
        {recPending && recJob.running && (
          <span className="flex items-center gap-1 text-xs text-neutral-400">
            <Sparkles size={11} /> 録音を要約中…
          </span>
        )}
        {jobError && <span className="truncate text-xs text-red-600">失敗: {jobError}</span>}
      </div>

      {showDraftInput && (
        <div className="flex items-center gap-1.5">
          <Input
            autoFocus
            placeholder="下書きの指示 例: リリース手順のチェックリスト"
            value={draftPrompt}
            onChange={(e) => setDraftPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runDraft()
              if (e.key === 'Escape') setShowDraftInput(false)
            }}
          />
          <Button size="sm" variant="primary" disabled={!draftPrompt.trim()} onClick={() => void runDraft()}>
            生成
          </Button>
        </div>
      )}

      {sumJob.job?.status === 'done' && sumJob.job.result && (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-2.5">
          <div className="mb-1 flex items-center gap-2">
            <Badge tone="green">要約</Badge>
            <div className="ml-auto flex gap-1">
              <Button size="sm" variant="outline" onClick={() => insertMarkdown(`## 要約\n\n${sumJob.job?.result ?? ''}`, 'end')}>
                文末に挿入
              </Button>
              <Button size="sm" variant="outline" disabled={sumSaved} onClick={() => void saveSummary()}>
                <Save size={12} />
                {sumSaved ? '保存済み' : 'ツリーに保存'}
              </Button>
            </div>
          </div>
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-neutral-800">
            {sumJob.job.result}
          </p>
        </div>
      )}
    </div>
  )
}
