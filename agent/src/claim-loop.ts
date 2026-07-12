import type { ApiClient } from './api-client.js'
import type { CliRunner } from './cli-runner.js'
import type { AiJob } from './types.js'

/** instruction を持たない旧形式ジョブ用のフォールバック（ボード要約） */
const LEGACY_SYSTEM_PROMPT = `あなたはチームのコンテキスト管理アプリ「Kurari」のAIアシスタントです。
以下に渡すのは、あるボード上の付箋とコメントの一覧です。
内容を簡潔に日本語で要約してください。論点・決定事項・未解決の疑問があれば分けて示してください。
コードの編集やコマンド実行は不要です。テキストで回答だけを返してください。`

// ジョブ種別ごとの instruction はバックエンドが payload に同梱する。
// Agent は結合するだけで、種別を知らない（種別追加時に Agent の改修は不要）。
function buildPrompt(job: AiJob): string {
  const instruction =
    typeof job.payload.instruction === 'string' && job.payload.instruction
      ? job.payload.instruction
      : LEGACY_SYSTEM_PROMPT
  const parts = [instruction, '', '---', job.context ?? '(コンテキストなし)', '---']
  const extra = job.payload.prompt
  if (extra) {
    parts.push('', `ユーザーの指示・質問: ${extra}`)
  }
  return parts.join('\n')
}

/** ジョブが指定するエンジン（payload.runner）を選ぶ。無指定・不在なら先頭 */
function pickRunner(runners: CliRunner[], job: AiJob): CliRunner {
  const want = job.payload.runner
  return runners.find((r) => r.id === want) ?? runners[0]
}

export async function runClaimLoop(opts: {
  api: ApiClient
  runners: CliRunner[]
  pollIntervalMs: number
  heartbeatIntervalMs: number
  log: (msg: string) => void
}): Promise<never> {
  const { api, runners, pollIntervalMs, heartbeatIntervalMs, log } = opts

  // heartbeat（claim も heartbeat を兼ねるが、実行中の途絶を防ぐため独立に送る）
  setInterval(() => {
    api.heartbeat().catch(() => {
      /* 次のループで再試行 */
    })
  }, heartbeatIntervalMs)

  let serverWasDown = false
  for (;;) {
    try {
      const job = await api.claimJob()
      if (serverWasDown) {
        log('サーバーへ再接続しました')
        serverWasDown = false
      }
      if (job) {
        const runner = pickRunner(runners, job)
        log(`job ${job.id} (${job.type}) を ${runner.id} で実行します…`)
        try {
          const started = Date.now()
          const result = await runner.run(buildPrompt(job))
          await api.completeJob(job.id, { result })
          log(`job ${job.id} 完了 (${((Date.now() - started) / 1000).toFixed(1)}s)`)
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          log(`job ${job.id} 失敗: ${message}`)
          await api.completeJob(job.id, { error: message }).catch(() => {})
        }
        continue // ジョブがあった直後は待たずに次を見る
      }
    } catch (e) {
      if (!serverWasDown) {
        log(`サーバーに接続できません（再試行し続けます）: ${e instanceof Error ? e.message : e}`)
        serverWasDown = true
      }
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs))
  }
}
