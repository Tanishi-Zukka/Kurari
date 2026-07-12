import { useEntityStore } from '@/stores/entity-store'
import { useUiStore } from '@/stores/ui-store'
import { ModeToggle } from './ModeToggle'
import { PresenceAvatars } from './PresenceAvatars'
import { InviteButton } from '@/components/access/InviteButton'
import { useAccessStore } from '@/stores/access-store'
import { Button } from '@/components/ui/primitives'
import { PanelLeft, PanelRight } from 'lucide-react'

export function Header() {
  const workspaceId = useEntityStore((s) => s.workspaceId)
  const workspaceName = useEntityStore((s) => (workspaceId ? s.nodes[workspaceId]?.name : null))
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const togglePanel = useUiStore((s) => s.togglePanel)
  const isOwner = useAccessStore((s) => s.role === 'owner')

  return (
    <header className="grid h-12 grid-cols-3 items-center border-b border-neutral-200 bg-white px-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={toggleSidebar} title="左サイドバー切替">
          <PanelLeft size={15} />
        </Button>
        <span className="text-sm font-bold tracking-tight text-neutral-900">Kurari</span>
        <span className="text-xs text-neutral-400">/</span>
        <span className="text-sm text-neutral-600">{workspaceName ?? '…'}</span>
      </div>
      <div className="flex justify-center">
        <ModeToggle />
      </div>
      <div className="flex items-center justify-end gap-3">
        <PresenceAvatars />
        <div className="flex items-center">
          {isOwner && <InviteButton />}
          <Button variant="ghost" size="icon" onClick={togglePanel} title="Context Panel切替">
            <PanelRight size={15} />
          </Button>
        </div>
      </div>
    </header>
  )
}
