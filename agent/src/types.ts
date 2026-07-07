export interface AiJob {
  id: string
  type: string
  status: 'pending' | 'claimed' | 'done' | 'failed'
  payload: { boardId?: string; prompt?: string | null }
  context: string | null
  result: string | null
  error: string | null
  createdAt: string
  updatedAt: string
}
