import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useEntityStore } from '@/stores/entity-store'
import { useUiStore } from '@/stores/ui-store'
import { cn } from '@/lib/utils'
import type { TreeItem } from './TreeView'
import type { NodeType } from '@/types/model'
import {
  Boxes, Folder, LayoutDashboard, StickyNote, MessageSquare, Sparkles,
  FileText, ChevronRight, ChevronDown, Trash2, Layers,
} from 'lucide-react'

const ICONS: Partial<Record<NodeType, typeof Boxes>> = {
  workspace: Boxes,
  project: Folder,
  board: LayoutDashboard,
  sticky: StickyNote,
  comment: MessageSquare,
  ai_summary: Sparkles,
  document: FileText,
  group: Layers,
}

/** ボード系ノードか（クリックでボードを開き、パンする対象か） */
const BOARD_ITEM_TYPES: NodeType[] = ['sticky', 'text_card', 'shape']

export function TreeNodeRow({ item }: { item: TreeItem }) {
  const { node, depth, children } = item
  const [expanded, setExpanded] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(node.name)

  const selectedIds = useUiStore((s) => s.selectedIds)
  const setSelected = useUiStore((s) => s.setSelected)
  const setActiveBoard = useUiStore((s) => s.setActiveBoard)
  const setPanelTab = useUiStore((s) => s.setPanelTab)
  const updateNode = useEntityStore((s) => s.updateNode)
  const removeNode = useEntityStore((s) => s.removeNode)
  const navigate = useNavigate()

  const Icon = ICONS[node.type] ?? FileText
  const selected = selectedIds.includes(node.id)
  const isBoardItem = BOARD_ITEM_TYPES.includes(node.type)

  const handleClick = () => {
    if (node.type === 'board') {
      setActiveBoard(node.id)
      setSelected([node.id])
      navigate('/board')
      return
    }
    if (isBoardItem && node.parentId) {
      // 付箋等: 親ボードを開き、選択＋パン
      setActiveBoard(node.parentId)
      setSelected([node.id], { pan: true })
      navigate('/board')
      return
    }
    if (node.type === 'comment') {
      if (node.parentId) setSelected([node.parentId], { pan: true })
      setPanelTab('comments')
      return
    }
    setSelected([node.id])
  }

  const commitRename = async () => {
    setEditing(false)
    const name = draft.trim()
    if (name && name !== node.name) {
      await updateNode(node.id, { name })
    } else {
      setDraft(node.name)
    }
  }

  const canDelete = node.type !== 'workspace' && node.type !== 'project'

  return (
    <div>
      <div
        className={cn(
          'group flex h-7 cursor-pointer items-center gap-1 rounded-md pr-1 text-[13px]',
          selected ? 'bg-neutral-200/80 text-neutral-900' : 'text-neutral-600 hover:bg-neutral-100',
        )}
        style={{ paddingLeft: 4 + depth * 14 }}
        onClick={handleClick}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setDraft(node.name)
          setEditing(true)
        }}
        data-tree-id={node.id}
      >
        <button
          className={cn(
            'flex h-4 w-4 items-center justify-center rounded text-neutral-400 hover:text-neutral-700',
            children.length === 0 && 'invisible',
          )}
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((v) => !v)
          }}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <Icon size={13} className="shrink-0 text-neutral-500" />
        {editing ? (
          <input
            autoFocus
            className="h-5 min-w-0 flex-1 rounded border border-neutral-300 bg-white px-1 text-[13px] outline-none"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') {
                setDraft(node.name)
                setEditing(false)
              }
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{node.name || '(untitled)'}</span>
        )}
        {canDelete && !editing && (
          <button
            className="invisible h-5 w-5 shrink-0 rounded text-neutral-400 hover:text-red-600 group-hover:visible"
            title="削除"
            onClick={(e) => {
              e.stopPropagation()
              void removeNode(node.id)
            }}
          >
            <Trash2 size={12} className="mx-auto" />
          </button>
        )}
      </div>
      {expanded &&
        children.map((child) => <TreeNodeRow key={child.node.id} item={child} />)}
    </div>
  )
}
