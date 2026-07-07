#!/usr/bin/env node
import { ApiClient } from './api-client.js'
import { CopilotCliRunner } from './cli-runner.js'
import { runClaimLoop } from './claim-loop.js'

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const server = argValue('--server') ?? process.env.KURARI_SERVER ?? 'http://localhost:8080'
const token = argValue('--token') ?? process.env.KURARI_AGENT_TOKEN
const pollIntervalMs = Number(argValue('--poll-interval-ms') ?? 2000)
const timeoutMs = Number(argValue('--timeout-ms') ?? 90_000)

const log = (msg: string) => console.log(`[kurari-agent] ${new Date().toISOString()} ${msg}`)

async function main() {
  log(`server: ${server}`)
  const runner = new CopilotCliRunner('copilot', timeoutMs)

  const availability = await runner.checkAvailability()
  if (!availability.ok) {
    log(`エラー: Copilot CLI が利用できません — ${availability.detail}`)
    log('GitHub Copilot CLI をインストール・ログインしてから再実行してください。')
    process.exit(1)
  }
  log(`Copilot CLI OK: ${availability.detail}`)

  const api = new ApiClient(server, token)
  try {
    await api.heartbeat()
    log('バックエンドに接続しました。ジョブを待機します…')
  } catch {
    log('バックエンドにまだ接続できません。接続できるまで再試行します…')
  }

  await runClaimLoop({
    api,
    runner,
    pollIntervalMs,
    heartbeatIntervalMs: 30_000,
    log,
  })
}

main().catch((e) => {
  log(`fatal: ${e instanceof Error ? e.stack ?? e.message : e}`)
  process.exit(1)
})
