import { useMemo } from 'react'
import { useEntityStore } from '@/stores/entity-store'
import { useUiStore } from '@/stores/ui-store'
import { useHistoryStore } from '@/stores/history-store'
import { useNavigateToNode } from '@/lib/navigate-node'
import { usePresenceStore } from '@/stores/presence-store'
import { cn } from '@/lib/utils'
import { derivedFromOf, isTaskOverdue, taskData, taskStatus, taskStatusPatch, type KNode, type NodeType, type TaskAssignee } from '@/types/model'
import { CheckCheck, CornerUpLeft, HelpCircle, ListTodo } from 'lucide-react'
import { STROKE_COLORS } from '@/components/board/BoardNodes'

/**
 * Decisions タブ: プロジェクトの合意状態（決定事項・未解決・タスク）を一覧する。
 * group 名には依存せず type ベースで集計する（手動でどこに作られても拾える）。
 */
export function DecisionsTab() {
  const nodes = useEntityStore((s) => s.nodes)
  const updateNode = useEntityStore((s) => s.updateNode)
  const selectedIds = useUiStore((s) => s.selectedIds)
  const setSelected = useUiStore((s) => s.setSelected)
  const navigateToNode = useNavigateToNode()
  const identity = usePresenceStore((s) => s.identity)
  const peers = usePresenceStore((s) => s.peers)

  const assigneeCandidates = useMemo(() => {
    const byClient = new Map<string, TaskAssignee>()
    byClient.set(identity.clientId, { clientId: identity.clientId, name: identity.name || '匿名', color: identity.color })
    for (const peer of Object.values(peers)) {
      if (peer.clientId !== identity.clientId && !byClient.has(peer.clientId)) {
        byClient.set(peer.clientId, { clientId: peer.clientId, name: peer.name || '匿名', color: peer.color })
      }
    }
    return [...byClient.values()]
  }, [identity, peers])

  const byType = useMemo(() => {
    const result: Record<'decision' | 'open_question' | 'task', KNode[]> = {
      decision: [],
      open_question: [],
      task: [],
    }
    for (const n of Object.values(nodes)) {
      if (n.type === 'decision' || n.type === 'open_question' || n.type === 'task') {
        result[n.type].push(n)
      }
    }
    for (const list of Object.values(result)) {
      list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    }
    return result
  }, [nodes])

  const patchTask = async (n: KNode, next: Record<string, unknown>, prev: Record<string, unknown>) => {
    await updateNode(n.id, { data: next })
    useHistoryStore.getState().push({
      undo: () => updateNode(n.id, { data: prev }),
      redo: () => updateNode(n.id, { data: next }),
    })
  }

  const toggleTask = (n: KNode) => {
    const cur = taskData(n).done
    const prevStatus = taskStatus(n)
    return patchTask(n, taskStatusPatch(cur ? 'todo' : 'done'), { status: prevStatus, done: cur })
  }

  const jumpToSource = (n: KNode) => {
    const sourceId = derivedFromOf(n)
    const source = sourceId ? nodes[sourceId] : undefined
    if (source) navigateToNode(source)
  }

  const renderRow = (n: KNode) => {
    const sourceId = derivedFromOf(n)
    const sourceExists = !!(sourceId && nodes[sourceId])
    const isTask = n.type === 'task'
    const task = isTask ? taskData(n) : null
    const done = !!task?.done
    const overdue = !!task && isTaskOverdue(task)
    const text = typeof n.data.text === 'string' && n.data.text ? n.data.text : n.name
    return (
      <li
        key={n.id}
        className={cn(
          'group flex items-start gap-1.5 rounded-md px-1.5 py-1 text-[13px] leading-relaxed',
          selectedIds.includes(n.id) ? 'bg-neutral-200/80' : 'hover:bg-neutral-100',
        )}
        onClick={() => setSelected([n.id])}
        data-testid={isTask ? 'task-item' : `${n.type}-item`}
        data-overdue={overdue ? 'true' : undefined}
      >
        {isTask && (
          <input
            type="checkbox"
            className="mt-1 shrink-0 accent-neutral-700"
            checked={done}
            onChange={() => void toggleTask(n)}
            onClick={(e) => e.stopPropagation()}
            title={done ? '未完了に戻す' : '完了にする'}
            data-testid="task-toggle"
          />
        )}
        <div className="min-w-0 flex-1">
          <span className={cn('whitespace-pre-wrap break-words text-neutral-800', done && 'text-neutral-400 line-through')}>{text}</span>
          {task && (
            <div className="mt-1 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
              <input
                type="date"
                data-testid="task-due-input"
                value={task.dueDate ?? ''}
                className={cn('min-w-0 w-[118px] rounded border border-neutral-200 bg-white px-1 py-0.5 text-[10px]', overdue && 'text-red-600')}
                onChange={(e) => void patchTask(n, { dueDate: e.target.value || null }, { dueDate: task.dueDate ?? null })}
              />
              {task.assignee && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: STROKE_COLORS[task.assignee.color] ?? STROKE_COLORS.gray }} />}
              <select
                data-testid="task-assignee-select"
                value={task.assignee?.clientId ?? ''}
                className="min-w-0 flex-1 rounded border border-neutral-200 bg-white px-1 py-0.5 text-[10px]"
                onChange={(e) => {
                  const next = assigneeCandidates.find((candidate) => candidate.clientId === e.target.value)
                  void patchTask(n, { assignee: next ?? null }, { assignee: task.assignee ?? null })
                }}
              >
                <option value="">担当なし</option>
                {assigneeCandidates.map((candidate) => <option key={candidate.clientId} value={candidate.clientId}>{candidate.name}{candidate.clientId === identity.clientId ? '（自分）' : ''}</option>)}
                {task.assignee && !assigneeCandidates.some((candidate) => candidate.clientId === task.assignee?.clientId) && <option value={task.assignee.clientId}>{task.assignee.name}</option>}
              </select>
            </div>
          )}
        </div>
        {sourceId && (
          <button
            className="invisible mt-0.5 shrink-0 rounded p-0.5 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 disabled:opacity-40 group-hover:visible"
            title={sourceExists ? '派生元へジャンプ' : '派生元は削除されました'}
            disabled={!sourceExists}
            onClick={(e) => {
              e.stopPropagation()
              jumpToSource(n)
            }}
            data-testid="jump-source"
          >
            <CornerUpLeft size={12} />
          </button>
        )}
      </li>
    )
  }

  const sections: { type: NodeType; label: string; icon: typeof CheckCheck; empty: string }[] = [
    { type: 'decision', label: '決定事項', icon: CheckCheck, empty: 'まだありません' },
    { type: 'open_question', label: '未解決', icon: HelpCircle, empty: 'まだありません' },
    { type: 'task', label: 'タスク', icon: ListTodo, empty: 'まだありません' },
  ]

  return (
    <div className="flex flex-col gap-3 p-3" data-testid="decisions-tab">
      <p className="text-[11px] leading-relaxed text-neutral-400">
        チャットのメッセージやボードの付箋から「タスク化」「意思決定ログ化」で追加できます。
        AI Mode の意思決定抽出の保存先もここに表示されます。
      </p>
      {sections.map(({ type, label, icon: Icon, empty }) => {
        const list = byType[type as 'decision' | 'open_question' | 'task']
        return (
          <div key={type}>
            <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-neutral-600">
              <Icon size={12} />
              {label}
              <span className="text-neutral-400">({list.length})</span>
            </p>
            {list.length === 0 ? (
              <p className="px-1.5 text-xs text-neutral-400">{empty}</p>
            ) : (
              <ul className="flex flex-col">{list.map(renderRow)}</ul>
            )}
          </div>
        )
      })}
    </div>
  )
}
