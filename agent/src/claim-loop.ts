import type { ApiClient } from './api-client.js'
import type { CliRunner } from './cli-runner.js'
import type { AiJob } from './types.js'

const SYSTEM_PROMPT = `あなたはチームのコンテキスト管理アプリ「Kurari」のAIアシスタントです。
以下に渡すのは、あるボード上の付箋とコメントの一覧です。
内容を簡潔に日本語で要約してください。論点・決定事項・未解決の疑問があれば分けて示してください。
コードの編集やコマンド実行は不要です。テキストで回答だけを返してください。`

function buildPrompt(job: AiJob): string {
  const parts = [SYSTEM_PROMPT, '', '---', job.context ?? '(コンテキストなし)', '---']
  const extra = job.payload.prompt
  if (extra) {
    parts.push('', `追加の指示: ${extra}`)
  }
  return parts.join('\n')
}

export async function runClaimLoop(opts: {
  api: ApiClient
  runner: CliRunner
  pollIntervalMs: number
  heartbeatIntervalMs: number
  log: (msg: string) => void
}): Promise<never> {
  const { api, runner, pollIntervalMs, heartbeatIntervalMs, log } = opts

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
        log(`job ${job.id} (${job.type}) を実行します…`)
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
