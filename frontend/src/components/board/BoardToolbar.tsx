import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'
import { useReactFlow } from '@xyflow/react'
import {
  MousePointer2,
  StickyNote,
  Type,
  Square,
  Circle,
  Frame,
  ArrowRight,
  PenLine,
  Image as ImageIcon,
  Trash2,
  Undo2,
  Redo2,
  ListTodo,
  CheckCheck,
  MessageCircle,
  SmilePlus,
  Vote,
} from 'lucide-react'
import { useHistoryStore } from '@/stores/history-store'
import { useEntityStore } from '@/stores/entity-store'
import { useUiStore } from '@/stores/ui-store'
import { deriveNodes, type DeriveKind } from '@/lib/derive'
import type { StickyColor } from '@/types/model'
import { REACTION_EMOJIS } from '@/lib/reactions'
import { boardItemIds } from '@/lib/board-layout'
import { myRemaining, voteSessionOf } from '@/lib/votes'
import { usePresenceStore } from '@/stores/presence-store'

/** 派生（タスク化・意思決定ログ化）の対象になるボード要素種別 */
const DERIVABLE_TYPES = ['sticky', 'text_card', 'shape'] as const

export type NewItemKind = 'sticky' | 'text_card' | 'rect' | 'ellipse' | 'section' | 'comment_pin'
export type BoardTool = 'select' | 'pen'

const COLORS: { color: StickyColor; className: string }[] = [
  { color: 'yellow', className: 'bg-amber-200' },
  { color: 'blue', className: 'bg-sky-200' },
  { color: 'pink', className: 'bg-pink-200' },
  { color: 'green', className: 'bg-emerald-200' },
  { color: 'gray', className: 'bg-neutral-300' },
]

export function BoardToolbar({
  activeTool,
  onSelectTool,
  onPenTool,
  placing,
  onPickPlace,
  onImageClick,
  selectedIds,
  onRecolor,
  color,
  onColorChange,
  translucent,
  onTranslucentChange,
  reactionEmoji,
  onPickReaction,
}: {
  activeTool: BoardTool
  onSelectTool: () => void
  onPenTool: () => void
  /** 配置モード中の要素種別（ツールを選ぶ→カーソルで配置場所を決める） */
  placing: NewItemKind | null
  onPickPlace: (kind: NewItemKind) => void
  onImageClick: () => void
  selectedIds: string[]
  onRecolor: (color: StickyColor, translucent: boolean) => void
  color: StickyColor
  onColorChange: (color: StickyColor) => void
  translucent: boolean
  onTranslucentChange: (v: boolean) => void
  reactionEmoji: string | null
  onPickReaction: (emoji: string | null) => void
}) {
  const { getNodes, getEdges, deleteElements } = useReactFlow()
  const canUndo = useHistoryStore((s) => s.past.length > 0)
  const canRedo = useHistoryStore((s) => s.future.length > 0)
  const undo = useHistoryStore((s) => s.undo)
  const redo = useHistoryStore((s) => s.redo)
  const showHandles = useUiStore((s) => s.showHandles)
  const toggleShowHandles = useUiStore((s) => s.toggleShowHandles)
  const activeBoardId = useUiStore((s) => s.activeBoardId)
  const voteMode = useUiStore((s) => s.voteMode)
  const setVoteMode = useUiStore((s) => s.setVoteMode)
  const nodes = useEntityStore((s) => s.nodes)
  const updateNode = useEntityStore((s) => s.updateNode)
  const identity = usePresenceStore((s) => s.identity)
  const [derivingKind, setDerivingKind] = useState<DeriveKind | null>(null)
  const [voteOpen, setVoteOpen] = useState(false)
  const [voteBudget, setVoteBudget] = useState(3)
  const voteSession = voteSessionOf(activeBoardId ? nodes[activeBoardId] : undefined)
  const remaining = activeBoardId && voteSession ? myRemaining(nodes, activeBoardId, voteSession, identity.clientId) : 0

  useEffect(() => {
    if (!voteSession?.active) setVoteMode(false)
  }, [voteSession?.active, setVoteMode])

  const startVoting = async () => {
    if (!activeBoardId) return
    for (const id of boardItemIds(nodes, activeBoardId)) {
      const node = nodes[id]
      if (node?.type === 'sticky' && node.data.votes) await updateNode(id, { data: { votes: null } })
    }
    await updateNode(activeBoardId, { data: { voteSession: { active: true, budget: voteBudget, startedBy: identity.clientId, startedAt: new Date().toISOString() } } })
    setVoteMode(true)
    setVoteOpen(false)
  }

  const endVoting = async () => {
    if (!activeBoardId || !voteSession) return
    await updateNode(activeBoardId, { data: { voteSession: { ...voteSession, active: false, endedAt: new Date().toISOString() } } })
    setVoteMode(false)
    setVoteOpen(false)
  }

  const hasSelection = selectedIds.length > 0

  // 選択中の派生対象（付箋・テキストカード・図形）。複数選択は1枚=1ノードで一括派生
  const derivable = selectedIds
    .map((id) => nodes[id])
    .filter((n) => n && (DERIVABLE_TYPES as readonly string[]).includes(n.type))

  const handleDerive = async (kind: DeriveKind) => {
    if (derivingKind || derivable.length === 0) return
    setDerivingKind(kind)
    try {
      const created = await deriveNodes(derivable, kind)
      if (created.length > 0) {
        const ui = useUiStore.getState()
        ui.setSelected(created.map((n) => n.id))
        ui.setPanelTab('decisions')
      }
    } finally {
      setDerivingKind(null)
    }
  }

  const handleDelete = () => {
    const nodes = getNodes().filter((n) => n.selected)
    const edges = getEdges().filter((e) => e.selected)
    if (nodes.length === 0 && edges.length === 0) return
    void deleteElements({ nodes, edges })
  }

  const handleColorClick = (c: StickyColor) => {
    onColorChange(c)
    if (hasSelection) onRecolor(c, translucent)
  }

  const handleTranslucentToggle = () => {
    const next = !translucent
    onTranslucentChange(next)
    if (hasSelection) onRecolor(color, next)
  }

  return (
    <div className="absolute left-1/2 top-3 z-10 flex w-max -translate-x-1/2 flex-nowrap items-center gap-1 whitespace-nowrap rounded-lg border border-neutral-200 bg-white px-2 py-1.5 shadow-sm">
      <Button
        size="icon"
        variant={reactionEmoji ? 'primary' : 'ghost'}
        onClick={() => onPickReaction(reactionEmoji ? null : REACTION_EMOJIS[0])}
        title="絵文字リアクション"
      >
        <SmilePlus size={15} />
      </Button>
      {reactionEmoji && (
        <div data-testid="reaction-palette" className="absolute left-0 top-full mt-1 flex gap-1 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg">
          {REACTION_EMOJIS.map((emoji) => (
            <button key={emoji} data-testid={`reaction-emoji-${emoji}`} className={cn('rounded p-1 text-lg hover:bg-neutral-100', reactionEmoji === emoji && 'bg-neutral-100 ring-1 ring-neutral-300')} onClick={() => onPickReaction(emoji)}>{emoji}</button>
          ))}
        </div>
      )}
      <div className="relative">
        <Button
          size="icon"
          variant={voteMode ? 'primary' : 'ghost'}
          data-testid="vote-toggle"
          title="付箋投票"
          onClick={() => {
            onSelectTool()
            setVoteOpen((value) => !value)
            if (voteSession?.active) setVoteMode(!voteMode)
          }}
        >
          <Vote size={15} />
        </Button>
        {voteOpen && (
          <div className="absolute left-0 top-full mt-1 w-48 rounded-lg border border-neutral-200 bg-white p-3 shadow-lg" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            {voteSession?.active ? (
              <>
                <p data-testid="vote-remaining" className="mb-2 text-xs text-neutral-600">残り {remaining} 票</p>
                <button data-testid="vote-end" className="w-full rounded bg-red-50 px-2 py-1.5 text-xs text-red-600" onClick={() => void endVoting()}>投票を終了</button>
              </>
            ) : (
              <>
                <label className="mb-2 flex items-center justify-between gap-2 text-xs text-neutral-600">1人あたり
                  <select data-testid="vote-budget" value={voteBudget} onChange={(e) => setVoteBudget(Number(e.target.value))} className="rounded border border-neutral-300 bg-white px-1 py-0.5">{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}票</option>)}</select>
                </label>
                <button data-testid="vote-start" className="w-full rounded bg-neutral-800 px-2 py-1.5 text-xs text-white" onClick={() => void startVoting()}>投票を開始</button>
              </>
            )}
          </div>
        )}
      </div>
      <Button
        size="icon"
        variant={placing === 'comment_pin' ? 'primary' : 'ghost'}
        onClick={() => onPickPlace('comment_pin')}
        title="コメントピンを追加"
      >
        <MessageCircle size={15} />
      </Button>
      <Button
        size="icon"
        variant={activeTool === 'select' && !placing ? 'primary' : 'ghost'}
        onClick={onSelectTool}
        title="選択"
      >
        <MousePointer2 size={15} />
      </Button>
      <Button
        size="icon"
        variant={placing === 'sticky' ? 'primary' : 'ghost'}
        onClick={() => onPickPlace('sticky')}
        title="付箋を追加"
      >
        <StickyNote size={15} />
      </Button>
      <Button
        size="icon"
        variant={placing === 'text_card' ? 'primary' : 'ghost'}
        onClick={() => onPickPlace('text_card')}
        title="テキストカードを追加"
      >
        <Type size={15} />
      </Button>
      <Button
        size="icon"
        variant={placing === 'rect' ? 'primary' : 'ghost'}
        onClick={() => onPickPlace('rect')}
        title="矩形を追加"
      >
        <Square size={15} />
      </Button>
      <Button
        size="icon"
        variant={placing === 'ellipse' ? 'primary' : 'ghost'}
        onClick={() => onPickPlace('ellipse')}
        title="楕円を追加"
      >
        <Circle size={15} />
      </Button>
      <Button
        size="icon"
        variant={placing === 'section' ? 'primary' : 'ghost'}
        onClick={() => onPickPlace('section')}
        title="セクションを追加"
      >
        <Frame size={15} />
      </Button>
      <Button
        size="icon"
        variant={showHandles ? 'primary' : 'ghost'}
        onClick={toggleShowHandles}
        title="接続ハンドルを表示"
      >
        <ArrowRight size={15} />
      </Button>
      <Button
        size="icon"
        variant={activeTool === 'pen' ? 'primary' : 'ghost'}
        onClick={onPenTool}
        title="ペンで描画"
      >
        <PenLine size={15} />
      </Button>
      <Button size="icon" variant="ghost" onClick={onImageClick} title="画像を追加">
        <ImageIcon size={15} />
      </Button>
      <div className="mx-1 h-5 w-px bg-neutral-200" />
      <div className="flex items-center gap-1">
        {COLORS.map((c) => (
          <button
            key={c.color}
            className={cn(
              'h-5 w-5 rounded-full border border-black/10 transition-transform',
              c.className,
              translucent && 'opacity-50',
              color === c.color && 'scale-110 ring-2 ring-neutral-500/50',
            )}
            onClick={() => handleColorClick(c.color)}
            title={hasSelection ? `選択範囲の色を変更: ${c.color}` : c.color}
          />
        ))}
        <button
          className={cn(
            'ml-0.5 flex h-5 items-center rounded border px-1 text-[10px] transition-colors',
            translucent
              ? 'border-neutral-500 bg-neutral-700 text-white'
              : 'border-neutral-300 bg-white text-neutral-500 hover:bg-neutral-100',
          )}
          onClick={handleTranslucentToggle}
          title="半透明（すべての色で選択可）"
        >
          50%
        </button>
      </div>
      {derivable.length > 0 && (
        <>
          <div className="mx-1 h-5 w-px bg-neutral-200" />
          <Button
            size="icon"
            variant="ghost"
            disabled={derivingKind !== null}
            onClick={() => void handleDerive('task')}
            title={`選択${derivable.length}件をタスク化`}
            data-testid="board-derive-task"
          >
            <ListTodo size={15} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            disabled={derivingKind !== null}
            onClick={() => void handleDerive('decision')}
            title={`選択${derivable.length}件を意思決定ログ化`}
            data-testid="board-derive-decision"
          >
            <CheckCheck size={15} />
          </Button>
        </>
      )}
      <div className="mx-1 h-5 w-px bg-neutral-200" />
      <Button size="icon" variant="ghost" onClick={handleDelete} disabled={!hasSelection} title="削除">
        <Trash2 size={15} />
      </Button>
      <Button size="icon" variant="ghost" onClick={() => void undo()} disabled={!canUndo} title="元に戻す">
        <Undo2 size={15} />
      </Button>
      <Button size="icon" variant="ghost" onClick={() => void redo()} disabled={!canRedo} title="やり直す">
        <Redo2 size={15} />
      </Button>
    </div>
  )
}
