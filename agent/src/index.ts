#!/usr/bin/env node
import { ApiClient } from './api-client.js'
import { AppleAiRunner, CopilotCliRunner, OllamaRunner, type CliRunner } from './cli-runner.js'
import { runClaimLoop } from './claim-loop.js'

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const server = argValue('--server') ?? process.env.KURARI_SERVER ?? 'http://localhost:8080'
const token = argValue('--token') ?? process.env.KURARI_AGENT_TOKEN
const pollIntervalMs = Number(argValue('--poll-interval-ms') ?? 2000)
const timeoutMs = Number(argValue('--timeout-ms') ?? 90_000)
const ollamaUrl = argValue('--ollama-url') ?? process.env.KURARI_OLLAMA_URL ?? 'http://localhost:11434'
const ollamaModel = argValue('--ollama-model') ?? process.env.KURARI_OLLAMA_MODEL

const log = (msg: string) => console.log(`[kurari-agent] ${new Date().toISOString()} ${msg}`)

async function main() {
  log(`server: ${server}`)

  // 全エンジンを起動時にチェックし、使えるものをすべて公開する。
  // どのエンジンで実行するかはジョブごとに Web ページ側が指定する（payload.runner）。
  const candidates: CliRunner[] = [
    new CopilotCliRunner('copilot', timeoutMs),
    new AppleAiRunner(timeoutMs),
    new OllamaRunner(ollamaUrl, ollamaModel, Math.max(timeoutMs, 120_000)),
  ]
  const runners: CliRunner[] = []
  for (const r of candidates) {
    const availability = await r.checkAvailability()
    if (availability.ok) {
      log(`✔ ${r.label()} — ${availability.detail}`)
      runners.push(r)
    } else {
      log(`✘ ${r.id} は利用不可 — ${availability.detail}`)
    }
  }
  if (runners.length === 0) {
    log('エラー: 利用可能なAIエンジンがありません（copilot / Apple Intelligence / Ollama のいずれかを用意してください）')
    process.exit(1)
  }

  const api = new ApiClient(server, token, runners.map((r) => ({ id: r.id, label: r.label() })))
  try {
    await api.heartbeat()
    log('バックエンドに接続しました。ジョブを待機します…')
  } catch {
    log('バックエンドにまだ接続できません。接続できるまで再試行します…')
  }

  await runClaimLoop({
    api,
    runners,
    pollIntervalMs,
    heartbeatIntervalMs: 30_000,
    log,
  })
}

main().catch((e) => {
  log(`fatal: ${e instanceof Error ? e.stack ?? e.message : e}`)
  process.exit(1)
})
