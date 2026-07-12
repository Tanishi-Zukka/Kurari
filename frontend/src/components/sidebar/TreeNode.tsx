import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useEntityStore } from '@/stores/entity-store'
import { useUiStore } from '@/stores/ui-store'
import { useNavigateToNode } from '@/lib/navigate-node'
import { cn } from '@/lib/utils'
import type { TreeItem } from './TreeView'
import { taskData, type NodeType } from '@/types/model'
import {
  Boxes, Folder, LayoutDashboard, StickyNote, MessageSquare, MessagesSquare, Sparkles,
  FileText, ChevronRight, ChevronDown, Trash2, Layers, Hash, Type, Square, Plus, Frame,
  CheckCheck, HelpCircle, ListTodo, Link,
} from 'lucide-react'

const ICONS: Partial<Record<NodeType, typeof Boxes>> = {
  workspace: Boxes,
  project: Folder,
  board: LayoutDashboard,
  sticky: StickyNote,
  text_card: Type,
  shape: Square,
  section: Frame,
  comment: MessageSquare,
  ai_summary: Sparkles,
  document: FileText,
  block: Hash,
  group: Layers,
  chat_room: MessagesSquare,
  message: MessageSquare,
  decision: CheckCheck,
  open_question: HelpCircle,
  task: ListTodo,
  link: Link,
}

export function TreeNodeRow({ item }: { item: TreeItem }) {
  const { node, depth, children } = item
  // チャット履歴はメッセージ数が多くツリーが氾濫するため初期折りたたみ
  const [expanded, setExpanded] = useState(node.type !== 'chat_room')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(node.name)

  const selectedIds = useUiStore((s) => s.selectedIds)
  const setSelected = useUiStore((s) => s.setSelected)
  const setActiveBoard = useUiStore((s) => s.setActiveBoard)
  const setActiveDoc = useUiStore((s) => s.setActiveDoc)
  const navigateToNode = useNavigateToNode()
  const updateNode = useEntityStore((s) => s.updateNode)
  const removeNode = useEntityStore((s) => s.removeNode)
  const createNode = useEntityStore((s) => s.createNode)
  const navigate = useNavigate()

  /** プロジェクト行の＋ボタン: ボード/ドキュメントを追加してすぐ開く */
  const addChild = async (type: 'board' | 'document') => {
    const created = await createNode({
      parentId: node.id,
      type,
      name: type === 'board' ? '新しいボード' : '無題のドキュメント',
      data: type === 'document' ? { content: [] } : {},
    })
    setSelected([created.id])
    if (type === 'board') {
      setActiveBoard(created.id)
      navigate('/board')
    } else {
      setActiveDoc(created.id)
      navigate('/doc')
    }
  }

  const Icon = ICONS[node.type] ?? FileText
  const selected = selectedIds.includes(node.id)
  const taskDone = node.type === 'task' && taskData(node).done

  const handleClick = () => navigateToNode(node)

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
          <span className={cn('min-w-0 flex-1 truncate', taskDone && 'text-neutral-400 line-through')}>
            {node.name || '(untitled)'}
          </span>
        )}
        {node.type === 'project' && !editing && (
          <span className="invisible flex shrink-0 items-center group-hover:visible">
            <button
              className="flex h-5 items-center gap-0.5 rounded px-1 text-[10px] text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
              title="ボードを追加"
              onClick={(e) => {
                e.stopPropagation()
                void addChild('board')
              }}
            >
              <Plus size={10} />
              <LayoutDashboard size={11} />
            </button>
            <button
              className="flex h-5 items-center gap-0.5 rounded px-1 text-[10px] text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
              title="ドキュメントを追加"
              onClick={(e) => {
                e.stopPropagation()
                void addChild('document')
              }}
            >
              <Plus size={10} />
              <FileText size={11} />
            </button>
          </span>
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
