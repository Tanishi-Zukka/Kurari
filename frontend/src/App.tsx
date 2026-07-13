import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useEntityStore } from '@/stores/entity-store'
import { useUiStore } from '@/stores/ui-store'
import { useAiJobStore } from '@/stores/ai-job-store'
import { usePresenceStore } from '@/stores/presence-store'
import { useCallStore } from '@/stores/call-store'
import { connectWs } from '@/lib/ws'
import { usePresenceLocation } from '@/lib/use-presence-location'
import { api } from '@/lib/api'
import { Header } from '@/components/layout/Header'
import { StatusBar } from '@/components/layout/StatusBar'
import { TreeView } from '@/components/sidebar/TreeView'
import { ContextPanel } from '@/components/panel/ContextPanel'
import { BoardMode } from '@/components/board/BoardMode'
import { DocumentMode } from '@/components/doc/DocumentMode'
import { CallMode } from '@/components/call/CallMode'
import { FloatingCallBar } from '@/components/call/FloatingCallBar'
import { AiMode } from '@/components/modes/AiMode'
import { PresenceNameDialog } from '@/components/layout/PresenceNameDialog'
import { JoinRequestScreen } from '@/components/access/JoinRequestScreen'
import { AccessRequestBanner } from '@/components/access/AccessRequestBanner'
import { useAccessStore } from '@/stores/access-store'
import { onUnauthorized } from '@/lib/access-token'

/** 自分の居場所をプレゼンス送信するだけのコンポーネント（Router 配下に置く必要がある） */
function PresenceReporter() {
  usePresenceLocation()
  return null
}

/**
 * アクセスゲート: オーナー（localhost）と承認済みメンバーだけアプリ本体を描画する。
 * ゲスト（LAN の未承認クライアント）は参加リクエスト画面のみ。
 */
export default function App() {
  const role = useAccessStore((s) => s.role)
  const refreshMe = useAccessStore((s) => s.refreshMe)

  useEffect(() => {
    // backend 再起動などでトークンが失効したら（401）ゲートへ落とす
    onUnauthorized(() => useAccessStore.getState().signOutToGuest())
    void refreshMe()
  }, [refreshMe])

  if (role === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-neutral-400">
        読み込み中…
      </div>
    )
  }
  if (role === 'guest') return <JoinRequestScreen />
  return <AuthorizedApp />
}

function AuthorizedApp() {
  const role = useAccessStore((s) => s.role)
  const load = useEntityStore((s) => s.load)
  const applyServerEvent = useEntityStore((s) => s.applyServerEvent)
  const loaded = useEntityStore((s) => s.loaded)
  const nodes = useEntityStore((s) => s.nodes)
  const setWsState = useUiStore((s) => s.setWsState)
  const setAiStatus = useUiStore((s) => s.setAiStatus)
  const activeBoardId = useUiStore((s) => s.activeBoardId)
  const setActiveBoard = useUiStore((s) => s.setActiveBoard)

  // 初期ロード
  useEffect(() => {
    void load()
  }, [load])

  // WS 接続（受信ディスパッチ + プレゼンスの join/keepalive）
  useEffect(() => {
    const conn = connectWs(
      (ev) => {
        if (ev.type.startsWith('node.') || ev.type.startsWith('edge.')) applyServerEvent(ev)
        else if (ev.type === 'ai_job.updated') useAiJobStore.getState().upsert(ev.payload)
        else if (ev.type.startsWith('presence.')) usePresenceStore.getState().applyPresenceEvent(ev)
        else if (ev.type.startsWith('access.')) useAccessStore.getState().applyAccessEvent(ev)
        else if (ev.type.startsWith('call.')) useCallStore.getState().applyCallEvent(ev)
      },
      (state) => {
        setWsState(state)
        // 再接続のたびに join し直す（サーバ側は新セッションとして登録される）
        if (state === 'open') usePresenceStore.getState().sendJoin()
        // 通話も同様（presence join の後に。切断時は PeerConnection を畳んで張り直す）
        useCallStore.getState().handleWsState(state)
      },
    )
    usePresenceStore.getState().bindSender(conn.send)
    useCallStore.getState().bindSender(conn.send)
    const keepalive = window.setInterval(() => usePresenceStore.getState().sendKeepalive(), 30000)
    return () => {
      window.clearInterval(keepalive)
      conn.close()
    }
  }, [applyServerEvent, setWsState])

  // AI status ポーリング
  useEffect(() => {
    let timer: number
    const tick = async () => {
      try {
        setAiStatus(await api.aiStatus())
      } catch {
        setAiStatus(null)
      }
      timer = window.setTimeout(tick, 10000)
    }
    void tick()
    return () => window.clearTimeout(timer)
  }, [setAiStatus])

  // 最初のボードを自動で開く
  useEffect(() => {
    if (!loaded || activeBoardId) return
    const firstBoard = Object.values(nodes).find((n) => n.type === 'board')
    if (firstBoard) setActiveBoard(firstBoard.id)
  }, [loaded, activeBoardId, nodes, setActiveBoard])

  return (
    <div className="flex h-screen flex-col bg-white text-neutral-900">
      <PresenceReporter />
      <PresenceNameDialog />
      {role === 'owner' && <AccessRequestBanner />}
      <Header />
      <div className="flex min-h-0 flex-1">
        <TreeView />
        <main className="min-w-0 flex-1 bg-neutral-50/30">
          <Routes>
            <Route path="/" element={<Navigate to="/board" replace />} />
            <Route path="/board" element={<BoardMode />} />
            <Route path="/doc" element={<DocumentMode />} />
            <Route path="/ai" element={<AiMode />} />
            <Route path="/call" element={<CallMode />} />
          </Routes>
        </main>
        <ContextPanel />
      </div>
      <FloatingCallBar />
      <StatusBar />
    </div>
  )
}
