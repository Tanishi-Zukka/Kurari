export interface AiJob {
  id: string
  type: string
  status: 'pending' | 'claimed' | 'done' | 'failed'
  payload: {
    targetId?: string | null
    prompt?: string | null
    /** バックエンドが種別ごとに同梱するシステムプロンプト */
    instruction?: string | null
    /** ページ側が選択した実行エンジン（copilot-cli / apple-ai / ollama） */
    runner?: string | null
    /** 旧形式ジョブとの互換用 */
    boardId?: string
  }
  context: string | null
  result: string | null
  error: string | null
  createdAt: string
  updatedAt: string
}
