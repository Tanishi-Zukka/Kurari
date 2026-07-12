import { useEntityStore } from '@/stores/entity-store'
import { useUiStore, type PanelTab } from '@/stores/ui-store'
import { cn } from '@/lib/utils'
import { CommentsTab } from './CommentsTab'
import { AiTab } from './AiTab'
import { ChatTab } from './ChatTab'
import { DecisionsTab } from './DecisionsTab'
import { StickyNote, LayoutDashboard, MessageSquare, Sparkles, History, CheckCheck } from 'lucide-react'

const TABS: { id: PanelTab; label: string; icon: typeof MessageSquare; disabled?: boolean }[] = [
  { id: 'comments', label: 'Comments', icon: MessageSquare },
  { id: 'ai', label: 'AI', icon: Sparkles },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'activity', label: 'Activity', icon: History, disabled: true },
  { id: 'decisions', label: 'Decisions', icon: CheckCheck },
]

export function ContextPanel() {
  const panelOpen = useUiStore((s) => s.panelOpen)
  const panelTab = useUiStore((s) => s.panelTab)
  const setPanelTab = useUiStore((s) => s.setPanelTab)
  const selectedIds = useUiStore((s) => s.selectedIds)
  const activeBoardId = useUiStore((s) => s.activeBoardId)
  const nodes = useEntityStore((s) => s.nodes)

  if (!panelOpen) return null

  // 選択中ノード（単一選択時）。未選択ならアクティブボードを文脈にする
  const contextNode =
    (selectedIds.length === 1 ? nodes[selectedIds[0]] : null) ??
    (activeBoardId ? nodes[activeBoardId] : null)

  const HeaderIcon = contextNode?.type === 'sticky' ? StickyNote : LayoutDashboard

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-hidden border-l border-neutral-200 bg-white">
      <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2.5">
        <HeaderIcon size={14} className="shrink-0 text-neutral-500" />
        <span className="truncate text-sm font-medium text-neutral-800">
          {contextNode ? contextNode.name || '(untitled)' : '未選択'}
        </span>
        {contextNode && (
          <span className="ml-auto shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">
            {contextNode.type}
          </span>
        )}
      </div>

      <div className="flex border-b border-neutral-200 px-1">
        {TABS.map(({ id, label, disabled }) => (
          <button
            key={id}
            disabled={disabled}
            onClick={() => setPanelTab(id)}
            title={disabled ? 'Planned' : undefined}
            className={cn(
              'relative px-2.5 py-2 text-xs font-medium transition-colors',
              disabled
                ? 'cursor-not-allowed text-neutral-300'
                : panelTab === id
                  ? 'text-neutral-900'
                  : 'text-neutral-500 hover:text-neutral-800',
              panelTab === id && !disabled && 'after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-neutral-800',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={cn('flex-1', panelTab === 'chat' ? 'min-h-0 overflow-hidden' : 'overflow-y-auto')}>
        {panelTab === 'comments' && <CommentsTab contextNodeId={contextNode?.id ?? null} />}
        {panelTab === 'ai' && <AiTab />}
        {panelTab === 'chat' && <ChatTab />}
        {panelTab === 'decisions' && <DecisionsTab />}
      </div>
    </aside>
  )
}
