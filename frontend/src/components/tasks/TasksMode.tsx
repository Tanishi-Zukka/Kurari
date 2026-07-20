import { useEffect, useMemo, useRef, useState } from 'react'
import { CornerUpLeft } from 'lucide-react'
import { useEntityStore } from '@/stores/entity-store'
import { useUiStore } from '@/stores/ui-store'
import { useHistoryStore } from '@/stores/history-store'
import { useNavigateToNode } from '@/lib/navigate-node'
import { isEditableTarget } from '@/lib/keyboard'
import { midKey } from '@/lib/order-key'
import { cn } from '@/lib/utils'
import { STROKE_COLORS } from '@/components/board/BoardNodes'
import { derivedFromOf, isTaskOverdue, TASK_STATUSES, taskData, taskStatus, taskStatusPatch, type KNode, type TaskStatus } from '@/types/model'

type DropTarget = { status: TaskStatus; index: number }
type TaskSnapshot = { orderKey: string; status: TaskStatus; done: boolean }

const sortTasks = (a: KNode, b: KNode) =>
  (a.orderKey || '').localeCompare(b.orderKey || '') || a.createdAt.localeCompare(b.createdAt)

export function TasksMode() {
  const nodes = useEntityStore((s) => s.nodes)
  const updateNode = useEntityStore((s) => s.updateNode)
  const selectedIds = useUiStore((s) => s.selectedIds)
  const setSelected = useUiStore((s) => s.setSelected)
  const navigateToNode = useNavigateToNode()
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const tasks = useMemo(() => Object.values(nodes).filter((node) => node.type === 'task').sort(sortTasks), [nodes])
  const columns = useMemo(() => Object.fromEntries(TASK_STATUSES.map(({ status }) => [status, tasks.filter((task) => taskStatus(task) === status)])) as Record<TaskStatus, KNode[]>, [tasks])
  const projectNames = useMemo(() => {
    const result: Record<string, string> = {}
    for (const task of tasks) {
      let current: KNode | undefined = task
      while (current) {
        if (current.type === 'project') { result[task.id] = current.name; break }
        current = current.parentId ? nodes[current.parentId] : undefined
      }
    }
    return result
  }, [tasks, nodes])

  useEffect(() => {
    if (selectedIds.length !== 1 || !nodes[selectedIds[0]] || nodes[selectedIds[0]].type !== 'task') return
    const id = selectedIds[0]
    const element = rootRef.current?.querySelector(`[data-node-id="${CSS.escape(id)}"]`)
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setFlashId(id)
    const timer = window.setTimeout(() => setFlashId(null), 1600)
    return () => window.clearTimeout(timer)
  }, [selectedIds, nodes])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return
      const mod = event.metaKey || event.ctrlKey
      if (!mod) return
      const key = event.key.toLowerCase()
      if (key === 'z') {
        event.preventDefault()
        if (event.shiftKey) void useHistoryStore.getState().redo()
        else void useHistoryStore.getState().undo()
      } else if (key === 'y') {
        event.preventDefault()
        void useHistoryStore.getState().redo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const commitDrop = async (target: DropTarget) => {
    const dragged = draggingId ? nodes[draggingId] : undefined
    if (!dragged) return
    const list = columns[target.status].filter((node) => node.id !== dragged.id)
    const index = Math.max(0, Math.min(target.index, list.length))
    const final = [...list.slice(0, index), dragged, ...list.slice(index)]
    const prevById = new Map<string, TaskSnapshot>()
    const nextById = new Map<string, TaskSnapshot>()
    const remember = (node: KNode, orderKey: string, status: TaskStatus) => {
      prevById.set(node.id, { orderKey: node.orderKey, status: taskStatus(node), done: taskData(node).done })
      nextById.set(node.id, { orderKey, ...taskStatusPatch(status) })
    }
    const before = final[index - 1]
    const after = final[index + 1]
    const usable = (!before || !!before.orderKey) && (!after || !!after.orderKey) && (!before || !after || before.orderKey.localeCompare(after.orderKey) < 0)
    if (usable) {
      remember(dragged, midKey(before?.orderKey || null, after?.orderKey || null), target.status)
    } else {
      let previous: string | null = null
      for (const node of final) {
        const key = midKey(previous, null)
        const status = node.id === dragged.id ? target.status : taskStatus(node)
        if (node.orderKey !== key || taskStatus(node) !== status) remember(node, key, status)
        previous = key
      }
    }
    for (const [id, next] of nextById) await updateNode(id, { orderKey: next.orderKey, data: taskStatusPatch(next.status) })
    if (nextById.size > 0) {
      useHistoryStore.getState().push({
        undo: async () => { for (const [id, prev] of prevById) await updateNode(id, { orderKey: prev.orderKey, data: { status: prev.status, done: prev.done } }) },
        redo: async () => { for (const [id, next] of nextById) await updateNode(id, { orderKey: next.orderKey, data: taskStatusPatch(next.status) }) },
      })
    }
    setDraggingId(null)
    setDropTarget(null)
  }

  return (
    <div ref={rootRef} className="h-full overflow-x-auto bg-neutral-50 p-4">
      {tasks.length === 0 && <p className="mb-3 text-sm text-neutral-400">チャットやボードの「タスク化」から作成できます</p>}
      <div className="grid min-w-[780px] grid-cols-3 gap-4">
        {TASK_STATUSES.map(({ status, label }) => {
          const list = columns[status]
          const active = dropTarget?.status === status
          return (
            <section
              key={status}
              data-testid={`kanban-col-${status}`}
              data-drag-over={active ? 'true' : undefined}
              className={cn('min-h-[240px] rounded-xl border border-neutral-200 bg-neutral-100/70 p-3', active && 'bg-sky-50 ring-1 ring-sky-300')}
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; if (event.target === event.currentTarget) setDropTarget({ status, index: list.filter((node) => node.id !== draggingId).length }) }}
              onDrop={(event) => { event.preventDefault(); void commitDrop(dropTarget?.status === status ? dropTarget : { status, index: list.length }) }}
            >
              <h2 className="mb-3 flex items-center justify-between text-sm font-semibold text-neutral-700"><span>{label}</span><span className="text-xs font-normal text-neutral-400">{list.length}</span></h2>
              <div className="space-y-2">
                {list.length === 0 && <p className="py-8 text-center text-xs text-neutral-400">なし</p>}
                {list.map((task, cardIndex) => {
                  const data = taskData(task)
                  const sourceId = derivedFromOf(task)
                  const source = sourceId ? nodes[sourceId] : undefined
                  const filteredIndex = list.slice(0, cardIndex).filter((node) => node.id !== draggingId).length
                  const showLine = dropTarget?.status === status && dropTarget.index === filteredIndex
                  return (
                    <div key={task.id}>
                      {showLine && <div className="mb-2 h-0.5 rounded bg-sky-500" />}
                      <article
                        draggable
                        data-testid="kanban-card"
                        data-node-id={task.id}
                        className={cn('group relative cursor-grab rounded-lg border border-neutral-200 bg-white p-3 shadow-sm active:cursor-grabbing', selectedIds.includes(task.id) && 'ring-2 ring-neutral-400', flashId === task.id && 'ring-2 ring-amber-400')}
                        onClick={() => setSelected([task.id])}
                        onDragStart={(event) => { setDraggingId(task.id); event.dataTransfer.setData('text/plain', task.id); event.dataTransfer.effectAllowed = 'move' }}
                        onDragEnd={() => { setDraggingId(null); setDropTarget(null) }}
                        onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; const rect = event.currentTarget.getBoundingClientRect(); setDropTarget({ status, index: filteredIndex + (event.clientY >= rect.top + rect.height / 2 ? 1 : 0) }) }}
                        onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void commitDrop(dropTarget ?? { status, index: filteredIndex }) }}
                      >
                        <p className="line-clamp-3 whitespace-pre-wrap text-sm text-neutral-800">{data.text || task.name}</p>
                        <p className="mt-1 text-[11px] text-neutral-400">{projectNames[task.id] || 'プロジェクト不明'}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {data.dueDate && <span data-overdue={isTaskOverdue(data) && status !== 'done' ? 'true' : undefined} className={cn('rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500', isTaskOverdue(data) && status !== 'done' && 'bg-red-50 text-red-600')}>{data.dueDate}</span>}
                          {data.assignee && <span className="flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: STROKE_COLORS[data.assignee.color] ?? STROKE_COLORS.gray }} />{data.assignee.name}</span>}
                        </div>
                        {sourceId && <button data-testid="kanban-jump-source" disabled={!source} title={source ? '派生元へジャンプ' : '派生元は削除されました'} className="absolute right-2 top-2 invisible rounded p-1 text-neutral-400 hover:bg-neutral-100 group-hover:visible disabled:opacity-30" onClick={(event) => { event.stopPropagation(); if (source) navigateToNode(source) }}><CornerUpLeft size={12} /></button>}
                      </article>
                    </div>
                  )
                })}
                {dropTarget?.status === status && dropTarget.index === list.filter((node) => node.id !== draggingId).length && list.length > 0 && <div className="h-0.5 rounded bg-sky-500" />}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
