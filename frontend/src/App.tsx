import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useEntityStore } from '@/stores/entity-store'
import { useUiStore } from '@/stores/ui-store'
import { useAiJobStore } from '@/stores/ai-job-store'
import { connectWs } from '@/lib/ws'
import { api } from '@/lib/api'
import { Header } from '@/components/layout/Header'
import { StatusBar } from '@/components/layout/StatusBar'
import { TreeView } from '@/components/sidebar/TreeView'
import { ContextPanel } from '@/components/panel/ContextPanel'
import { BoardMode } from '@/components/board/BoardMode'
import { DocumentMode } from '@/components/doc/DocumentMode'
import { CallPlaceholder } from '@/components/modes/Placeholders'
import { AiMode } from '@/components/modes/AiMode'

export default function App() {
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

  // WS 接続
  useEffect(() => {
    const disconnect = connectWs((ev) => {
      if (ev.type.startsWith('node.') || ev.type.startsWith('edge.')) applyServerEvent(ev)
      else if (ev.type === 'ai_job.updated') useAiJobStore.getState().upsert(ev.payload)
    }, setWsState)
    return disconnect
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
      <Header />
      <div className="flex min-h-0 flex-1">
        <TreeView />
        <main className="min-w-0 flex-1 bg-neutral-50/30">
          <Routes>
            <Route path="/" element={<Navigate to="/board" replace />} />
            <Route path="/board" element={<BoardMode />} />
            <Route path="/doc" element={<DocumentMode />} />
            <Route path="/ai" element={<AiMode />} />
            <Route path="/call" element={<CallPlaceholder />} />
          </Routes>
        </main>
        <ContextPanel />
      </div>
      <StatusBar />
    </div>
  )
}
