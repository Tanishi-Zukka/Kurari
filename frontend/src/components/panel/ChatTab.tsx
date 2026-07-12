import { useLocation } from 'react-router-dom'
import { useUiStore } from '@/stores/ui-store'
import { ChatView } from '@/components/chat/ChatView'

/**
 * Context Panel のチャットタブ。開いている画面に文脈を合わせる:
 * Doc モードならアクティブなドキュメント、それ以外はアクティブなボード。
 */
export function ChatTab() {
  const { pathname } = useLocation()
  const activeBoardId = useUiStore((s) => s.activeBoardId)
  const activeDocId = useUiStore((s) => s.activeDocId)

  const targetId = pathname.startsWith('/doc') && activeDocId ? activeDocId : activeBoardId

  if (!targetId) {
    return <p className="p-4 text-xs text-neutral-400">ボードまたはドキュメントを開くとAIチャットが使えます</p>
  }
  return <ChatView contextTargetId={targetId} compact />
}
