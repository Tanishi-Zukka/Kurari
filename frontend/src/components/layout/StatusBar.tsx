import { useEntityStore } from '@/stores/entity-store'
import { useUiStore } from '@/stores/ui-store'
import { Badge } from '@/components/ui/primitives'
import { RunnerSelect } from '@/components/ui/RunnerSelect'

export function StatusBar() {
  const nodeCount = useEntityStore((s) => Object.keys(s.nodes).length)
  const wsState = useUiStore((s) => s.wsState)
  const aiStatus = useUiStore((s) => s.aiStatus)

  return (
    <footer className="flex h-7 items-center gap-3 border-t border-neutral-200 bg-white px-3 text-[11px] text-neutral-500">
      <Badge tone={wsState === 'open' ? 'green' : 'amber'}>
        sync: {wsState === 'open' ? 'connected' : wsState}
      </Badge>
      {aiStatus ? (
        <Badge tone={aiStatus.agent === 'online' ? 'green' : aiStatus.mockMode ? 'amber' : 'red'}>
          AI Agent: {aiStatus.agent}
          {aiStatus.agent === 'offline' && aiStatus.mockMode ? ' (mock)' : ''}
        </Badge>
      ) : (
        <Badge tone="neutral">AI: …</Badge>
      )}
      <RunnerSelect className="h-5" />
      <span className="ml-auto">{nodeCount} nodes</span>
    </footer>
  )
}
