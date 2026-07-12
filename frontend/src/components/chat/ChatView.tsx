import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createAiJob } from '@/lib/ai-run'
import { childrenOf, useEntityStore } from '@/stores/entity-store'
import { useAiJobStore } from '@/stores/ai-job-store'
import { useUiStore } from '@/stores/ui-store'
import { deriveNodes, deriveSticky, type DeriveKind } from '@/lib/derive'
import { useNavigateToNode } from '@/lib/navigate-node'
import { Badge, Button, Spinner, Textarea } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'
import { CheckCheck, HelpCircle, ListTodo, SendHorizonal, Sparkles, StickyNote } from 'lucide-react'
import type { KNode } from '@/types/model'

/**
 * AIチャット。contextTargetId（board / document / project）に文脈が紐づく。
 * 履歴は対象ノード直下の chat_room / message ノードとしてツリーに永続化される。
 * AI応答の message ノードはバックエンドがジョブ完了時に作成し、WS経由でここに現れる。
 */
export function ChatView({
  contextTargetId,
  compact,
}: {
  contextTargetId: string
  compact?: boolean
}) {
  const nodes = useEntityStore((s) => s.nodes)
  const createNode = useEntityStore((s) => s.createNode)
  const jobs = useAiJobStore((s) => s.jobs)
  const aiStatus = useUiStore((s) => s.aiStatus)

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [deriving, setDeriving] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeBoardId = useUiStore((s) => s.activeBoardId)
  const selectedIds = useUiStore((s) => s.selectedIds)
  const navigateToNode = useNavigateToNode()

  const target = nodes[contextTargetId]
  const isProject = target?.type === 'project'

  const room = useMemo(
    () => childrenOf(nodes, contextTargetId).find((n) => n.type === 'chat_room') ?? null,
    [nodes, contextTargetId],
  )
  const messages = useMemo(
    () => (room ? childrenOf(nodes, room.id).filter((n) => n.type === 'message') : []),
    [nodes, room],
  )

  // この部屋の実行中/失敗ジョブ（「考え中…」とエラー行の表示に使う）
  const roomJobs = useMemo(
    () =>
      Object.values(jobs).filter(
        (j) => j.type === 'chat_reply' && room && j.payload.chatRoomId === room.id,
      ),
    [jobs, room],
  )
  const thinking = roomJobs.some((j) => j.status === 'pending' || j.status === 'claimed')
  const failedJob = useMemo(() => {
    const failed = roomJobs.filter((j) => j.status === 'failed')
    if (failed.length === 0) return null
    const latest = failed.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b))
    // 失敗より後にAI応答が来ていれば解消済みとみなす
    const lastAi = messages.filter((m) => m.data.author === 'ai').at(-1)
    if (lastAi && lastAi.createdAt > latest.updatedAt) return null
    return latest
  }, [roomJobs, messages])

  // この部屋のメッセージが（ツリー・派生元ジャンプ経由で）選択されたらスクロール＋ハイライト
  const selectedMsgId = useMemo(
    () =>
      selectedIds.length === 1 && messages.some((m) => m.id === selectedIds[0])
        ? selectedIds[0]
        : null,
    [selectedIds, messages],
  )
  useEffect(() => {
    if (!selectedMsgId) return
    const el = scrollRef.current?.querySelector(`[data-node-id="${selectedMsgId}"]`)
    el?.scrollIntoView({ block: 'center' })
    setFlashId(selectedMsgId)
    const t = window.setTimeout(() => setFlashId(null), 1600)
    return () => window.clearTimeout(t)
  }, [selectedMsgId])

  // 新着で最下部へ（選択メッセージの表示要求があるときはスキップ）
  useEffect(() => {
    if (selectedMsgId) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, thinking, selectedMsgId])

  /** メッセージからの派生（タスク化 / 意思決定ログ化 / 未解決記録 / 付箋化） */
  const deriveMessage = useCallback(
    async (m: KNode, kind: DeriveKind | 'sticky') => {
      if (deriving) return
      setDeriving(m.id)
      try {
        if (kind === 'sticky') {
          const boardId = useUiStore.getState().activeBoardId
          if (!boardId) return
          const node = await deriveSticky(m, boardId)
          navigateToNode(node)
        } else {
          const [node] = await deriveNodes([m], kind)
          if (node) {
            const ui = useUiStore.getState()
            ui.setSelected([node.id])
            ui.setPanelTab('decisions')
          }
        }
      } finally {
        setDeriving(null)
      }
    },
    [deriving, navigateToNode],
  )

  const ensureRoom = useCallback(async (): Promise<KNode> => {
    if (room) return room
    return createNode({
      parentId: contextTargetId,
      type: 'chat_room',
      name: isProject ? 'プロジェクトAIチャット' : 'AIチャット',
      data: { kind: isProject ? 'project' : 'context' },
    })
  }, [room, contextTargetId, isProject, createNode])

  const send = useCallback(
    async (text: string) => {
      const body = text.trim()
      if (!body || sending) return
      setSending(true)
      setSendError(null)
      try {
        const r = await ensureRoom()
        await createNode({
          parentId: r.id,
          type: 'message',
          name: body.replace(/\n/g, ' ').slice(0, 30),
          data: { author: 'user', text: body },
        })
        const job = await createAiJob({
          type: 'chat_reply',
          targetId: contextTargetId,
          chatRoomId: r.id,
          prompt: body,
        })
        useAiJobStore.getState().upsert(job)
        setDraft('')
      } catch (e) {
        setSendError(e instanceof Error ? e.message : String(e))
      } finally {
        setSending(false)
      }
    },
    [sending, ensureRoom, createNode, contextTargetId],
  )

  /** 失敗したジョブの再送（直前のユーザーメッセージを再利用） */
  const retry = useCallback(async () => {
    const prompt = failedJob?.payload.prompt
    if (!room || typeof prompt !== 'string') return
    try {
      const job = await createAiJob({
        type: 'chat_reply',
        targetId: contextTargetId,
        chatRoomId: room.id,
        prompt,
      })
      useAiJobStore.getState().upsert(job)
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e))
    }
  }, [failedJob, room, contextTargetId])

  if (!target) {
    return <p className="p-4 text-xs text-neutral-400">対象が見つかりません</p>
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="chat-view">
      <div ref={scrollRef} className={cn('flex-1 overflow-y-auto', compact ? 'p-2' : 'p-3')}>
        {messages.length === 0 && !thinking && (
          <p className="py-6 text-center text-xs text-neutral-400">
            {isProject
              ? 'プロジェクト全体について質問できます'
              : `「${target.name || '(untitled)'}」について質問できます`}
          </p>
        )}
        <div className="flex flex-col gap-2">
          {messages.map((m) => {
            const isAi = m.data.author === 'ai'
            const actions = (
              <span
                className={cn(
                  'invisible flex shrink-0 items-center gap-0.5 self-center group-hover/msg:visible',
                  deriving === m.id && 'visible',
                )}
              >
                <button
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 disabled:opacity-40"
                  title="タスク化"
                  data-testid="msg-action-task"
                  disabled={deriving !== null}
                  onClick={() => void deriveMessage(m, 'task')}
                >
                  <ListTodo size={13} />
                </button>
                <button
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 disabled:opacity-40"
                  title="意思決定ログ化"
                  data-testid="msg-action-decision"
                  disabled={deriving !== null}
                  onClick={() => void deriveMessage(m, 'decision')}
                >
                  <CheckCheck size={13} />
                </button>
                <button
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 disabled:opacity-40"
                  title="未解決として記録"
                  data-testid="msg-action-question"
                  disabled={deriving !== null}
                  onClick={() => void deriveMessage(m, 'open_question')}
                >
                  <HelpCircle size={13} />
                </button>
                <button
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 disabled:opacity-40"
                  title={activeBoardId ? '付箋化してボードに置く' : 'ボードを開くと付箋化できます'}
                  data-testid="msg-action-sticky"
                  disabled={deriving !== null || !activeBoardId}
                  onClick={() => void deriveMessage(m, 'sticky')}
                >
                  <StickyNote size={13} />
                </button>
              </span>
            )
            return (
              <div
                key={m.id}
                className={cn('group/msg flex gap-1', isAi ? 'justify-start' : 'justify-end')}
                data-testid={isAi ? 'chat-msg-ai' : 'chat-msg-user'}
                data-node-id={m.id}
              >
                {!isAi && actions}
                <div
                  className={cn(
                    'max-w-[85%] whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-[13px] leading-relaxed',
                    isAi
                      ? 'bg-neutral-100 text-neutral-800'
                      : 'bg-neutral-800 text-white',
                    flashId === m.id && 'ring-2 ring-amber-400',
                  )}
                >
                  {isAi && (
                    <span className="mb-0.5 flex items-center gap-1 text-[10px] font-medium text-neutral-400">
                      <Sparkles size={10} /> AI
                    </span>
                  )}
                  {typeof m.data.text === 'string' ? m.data.text : ''}
                </div>
                {isAi && actions}
              </div>
            )
          })}
          {thinking && (
            <div className="flex items-center gap-2 px-1 text-xs text-neutral-400">
              <Spinner /> AIが考え中…
            </div>
          )}
          {failedJob && !thinking && (
            <div className="flex items-center gap-2 px-1 text-xs text-red-600">
              <span className="truncate">応答に失敗: {failedJob.error ?? '不明なエラー'}</span>
              <Button size="sm" variant="outline" onClick={() => void retry()}>
                再送
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className={cn('border-t border-neutral-200', compact ? 'p-2' : 'p-3')}>
        {sendError && <p className="mb-1 text-xs text-red-600">{sendError}</p>}
        <div className="flex items-end gap-1.5">
          <Textarea
            rows={compact ? 1 : 2}
            placeholder={aiStatus?.agent === 'online' ? 'AIに質問・指示…' : 'AIに質問・指示…（Mock応答）'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void send(draft)
              }
            }}
            data-testid="chat-input"
          />
          <Button
            size="icon"
            variant="primary"
            disabled={sending || !draft.trim()}
            onClick={() => void send(draft)}
            title="送信 (⌘Enter)"
            data-testid="chat-send"
          >
            <SendHorizonal size={14} />
          </Button>
        </div>
        {aiStatus?.agent !== 'online' && aiStatus?.mockMode && (
          <div className="mt-1.5">
            <Badge tone="amber">Agent未接続 → Mock応答</Badge>
          </div>
        )}
      </div>
    </div>
  )
}
