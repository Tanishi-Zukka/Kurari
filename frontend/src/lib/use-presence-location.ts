import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useUiStore } from '@/stores/ui-store'
import { usePresenceStore } from '@/stores/presence-store'
import type { PresenceMode } from '@/types/model'

function modeOf(pathname: string): PresenceMode {
  if (pathname.startsWith('/doc')) return 'doc'
  if (pathname.startsWith('/tasks')) return 'tasks'
  if (pathname.startsWith('/ai')) return 'ai'
  if (pathname.startsWith('/call')) return 'call'
  return 'board'
}

/** 自分の居場所・選択の変化をプレゼンスとして送信する。Router 配下で1箇所だけ呼ぶ */
export function usePresenceLocation() {
  const { pathname } = useLocation()
  const activeBoardId = useUiStore((s) => s.activeBoardId)
  const activeDocId = useUiStore((s) => s.activeDocId)
  const selectedIds = useUiStore((s) => s.selectedIds)
  const editingDocId = usePresenceStore((s) => s.editingDocId)

  useEffect(() => {
    const mode = modeOf(pathname)
    usePresenceStore.getState().reportLocation(
      {
        mode,
        boardId: mode === 'board' ? activeBoardId : null,
        docId: mode === 'doc' ? activeDocId : null,
        editing: mode === 'doc' && activeDocId != null && editingDocId === activeDocId,
      },
      selectedIds,
    )
  }, [pathname, activeBoardId, activeDocId, selectedIds, editingDocId])
}
