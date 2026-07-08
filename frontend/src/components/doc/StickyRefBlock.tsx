import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { createReactBlockSpec } from '@blocknote/react'
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core'
import type { BlockNoteEditor } from '@blocknote/core'
import { useEntityStore } from '@/stores/entity-store'
import { useUiStore } from '@/stores/ui-store'
import { cn } from '@/lib/utils'
import { stickyData, type StickyColor } from '@/types/model'
import { StickyNote, ExternalLink, Unlink } from 'lucide-react'

const COLOR_CLASSES: Record<StickyColor, string> = {
  yellow: 'bg-amber-50 border-amber-300',
  blue: 'bg-sky-50 border-sky-300',
  pink: 'bg-pink-50 border-pink-300',
  green: 'bg-emerald-50 border-emerald-300',
}

/** 参照先が未選択のときに表示するインライン付箋ピッカー */
function StickyPicker({ onPick }: { onPick: (id: string) => void }) {
  const nodes = useEntityStore((s) => s.nodes)
  const stickies = useMemo(
    () =>
      Object.values(nodes)
        .filter((n) => n.type === 'sticky')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [nodes],
  )

  return (
    <div className="my-1 w-full rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-neutral-500">
        <StickyNote size={13} />
        埋め込む付箋を選択
      </p>
      {stickies.length === 0 && (
        <p className="text-xs text-neutral-400">ボードに付箋がありません</p>
      )}
      <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
        {stickies.map((s) => {
          const d = stickyData(s)
          return (
            <button
              key={s.id}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-neutral-700 hover:bg-neutral-100"
              onClick={() => onPick(s.id)}
            >
              <span
                className={cn(
                  'h-3 w-3 shrink-0 rounded-sm border',
                  COLOR_CLASSES[d.color] ?? COLOR_CLASSES.yellow,
                )}
              />
              <span className="truncate">{d.text.split('\n')[0] || '(empty sticky)'}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** 参照先の付箋をライブ描画するビュー（転記ではなくストア購読） */
function StickyRefView({
  refNodeId,
  onPick,
}: {
  refNodeId: string
  onPick: (id: string) => void
}) {
  const node = useEntityStore((s) => (refNodeId ? s.nodes[refNodeId] : undefined))
  const setActiveBoard = useUiStore((s) => s.setActiveBoard)
  const setSelected = useUiStore((s) => s.setSelected)
  const navigate = useNavigate()
  const boardName = useEntityStore((s) =>
    node?.parentId ? s.nodes[node.parentId]?.name : undefined,
  )

  if (!refNodeId) {
    return <StickyPicker onPick={onPick} />
  }

  if (!node) {
    return (
      <div className="my-1 flex w-full items-center gap-2 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-3 py-2 text-xs text-neutral-400">
        <Unlink size={13} />
        参照先の付箋が見つかりません（削除された可能性があります）
      </div>
    )
  }

  const d = stickyData(node)
  const openOnBoard = () => {
    if (!node.parentId) return
    setActiveBoard(node.parentId)
    setSelected([node.id], { pan: true })
    navigate('/board')
  }

  return (
    <div
      className={cn(
        'group/ref my-1 w-full cursor-pointer rounded-lg border-2 px-3 py-2.5 transition-shadow hover:shadow-sm',
        COLOR_CLASSES[d.color] ?? COLOR_CLASSES.yellow,
      )}
      onClick={openOnBoard}
      title="クリックでボードの該当付箋へ移動"
    >
      <div className="mb-1 flex items-center gap-1.5 text-[10px] text-neutral-400">
        <StickyNote size={11} />
        <span>付箋の参照{boardName ? ` — ${boardName}` : ''}</span>
        <ExternalLink size={11} className="ml-auto opacity-0 transition-opacity group-hover/ref:opacity-100" />
      </div>
      <p className="whitespace-pre-wrap text-[13px] leading-snug text-neutral-800">
        {d.text || '(empty sticky)'}
      </p>
    </div>
  )
}

/**
 * stickyRef カスタムブロック。
 * props.refNodeId で付箋ノードを参照し、内容はライブで描画する（生きた参照、転記ではない）。
 */
export const StickyRefBlockSpec = createReactBlockSpec(
  {
    type: 'stickyRef',
    propSchema: {
      refNodeId: { default: '' },
    },
    content: 'none',
  },
  {
    render: ({ block, editor }) => (
      <StickyRefView
        refNodeId={block.props.refNodeId}
        onPick={(id) =>
          editor.updateBlock(block, { type: 'stickyRef', props: { refNodeId: id } })
        }
      />
    ),
  },
)

/** スラッシュメニューの「付箋を埋め込む」項目 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function insertStickyRefItem(editor: BlockNoteEditor<any, any, any>) {
  return {
    title: '付箋を埋め込む',
    subtext: 'ボード上の付箋をライブ参照として挿入',
    aliases: ['sticky', 'fusen', 'ref', '付箋'],
    group: 'Kurari',
    icon: <StickyNote size={16} />,
    onItemClick: () => {
      insertOrUpdateBlockForSlashMenu(editor, { type: 'stickyRef' })
    },
  }
}
