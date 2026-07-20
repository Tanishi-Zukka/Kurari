import { boardItemIds } from '@/lib/board-layout'
import type { KNode } from '@/types/model'

/** 投票は共同セッション状態のためundo対象外。取り消しは専用の「−」操作で行う。 */
export interface VoteSession {
  active: boolean
  budget: number
  startedBy: string
  startedAt: string
  endedAt?: string
}

export type VoteMap = Record<string, number>

export function voteSessionOf(board: KNode | undefined): VoteSession | null {
  const value = board?.data.voteSession
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.active !== 'boolean' || typeof raw.budget !== 'number' || typeof raw.startedBy !== 'string' || typeof raw.startedAt !== 'string') return null
  return { active: raw.active, budget: Math.max(1, Math.min(5, raw.budget)), startedBy: raw.startedBy, startedAt: raw.startedAt, endedAt: typeof raw.endedAt === 'string' ? raw.endedAt : undefined }
}

export function votesOf(node: KNode): VoteMap {
  const value = node.data.votes
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 0))
}

export function totalVotes(node: KNode): number {
  return Object.values(votesOf(node)).reduce((sum, count) => sum + count, 0)
}

export function myRemaining(nodes: Record<string, KNode>, boardId: string, session: VoteSession, clientId: string): number {
  const used = boardItemIds(nodes, boardId).reduce((sum, id) => {
    const node = nodes[id]
    return sum + (node?.type === 'sticky' ? votesOf(node)[clientId] ?? 0 : 0)
  }, 0)
  return Math.max(0, session.budget - used)
}
