import { execFile, execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface CliRunner {
  readonly id: string
  /** UI表示用の名前。checkAvailability 成功後に確定する（Ollamaはモデル名を含む） */
  label(): string
  checkAvailability(): Promise<{ ok: boolean; detail: string }>
  run(prompt: string): Promise<string>
}

/**
 * GitHub Copilot CLI を非対話モードで実行するランナー。
 *   copilot -p "<prompt>" -s --no-color
 * -s (silent) で統計等を除いた応答本文のみが stdout に出る。
 */
export class CopilotCliRunner implements CliRunner {
  readonly id = 'copilot-cli'

  constructor(
    private readonly command = 'copilot',
    private readonly timeoutMs = 90_000,
  ) {}

  label(): string {
    return 'Copilot CLI'
  }

  checkAvailability(): Promise<{ ok: boolean; detail: string }> {
    return new Promise((resolve) => {
      execFile(this.command, ['--version'], { timeout: 10_000 }, (err, stdout) => {
        if (err) {
          resolve({ ok: false, detail: `\`${this.command} --version\` failed: ${err.message}` })
        } else {
          resolve({ ok: true, detail: stdout.trim().split('\n')[0] ?? 'unknown version' })
        }
      })
    })
  }

  run(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        this.command,
        ['-p', prompt, '-s', '--no-color'],
        { timeout: this.timeoutMs, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            const detail = stderr.trim().slice(0, 500) || err.message
            reject(new Error(`copilot failed: ${detail}`))
            return
          }
          const text = stdout.trim()
          if (!text) {
            reject(new Error(`copilot returned empty output. stderr: ${stderr.trim().slice(0, 300)}`))
            return
          }
          resolve(text)
        },
      )
    })
  }
}

/**
 * Apple Intelligence（macOS 26+ のオンデバイスモデル）を実行するランナー。
 * apple/kurari-apple-ai.swift を初回に swiftc でビルドし、プロンプトを stdin で渡す。
 * オンデバイスモデルはコンテキストが小さい（約4Kトークン）ため、
 * 長すぎるプロンプトはコンテキスト部分の中間を間引いてから渡す。
 */
export class AppleAiRunner implements CliRunner {
  readonly id = 'apple-ai'

  /** これを超えるプロンプトは中間を省略する（日本語でおおむね4Kトークン相当に収める） */
  private static readonly MAX_PROMPT_CHARS = 5000

  private readonly appleDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'apple')
  private readonly source = join(this.appleDir, 'kurari-apple-ai.swift')
  private readonly binary = join(this.appleDir, 'kurari-apple-ai')

  constructor(private readonly timeoutMs = 60_000) {}

  label(): string {
    return 'Apple Intelligence'
  }

  async checkAvailability(): Promise<{ ok: boolean; detail: string }> {
    if (process.platform !== 'darwin') {
      return { ok: false, detail: 'Apple Intelligence は macOS でのみ利用できます' }
    }
    // バイナリが無い/ソースより古いときは swiftc でビルド（初回のみ数秒）
    try {
      const needBuild =
        !existsSync(this.binary) || statSync(this.binary).mtimeMs < statSync(this.source).mtimeMs
      if (needBuild) {
        execFileSync('swiftc', ['-parse-as-library', '-O', this.source, '-o', this.binary], {
          timeout: 120_000,
        })
      }
    } catch (e) {
      return {
        ok: false,
        detail: `ビルドに失敗しました（Xcode Command Line Tools が必要）: ${e instanceof Error ? e.message.slice(0, 300) : e}`,
      }
    }
    return new Promise((resolve) => {
      execFile(this.binary, ['--check'], { timeout: 15_000 }, (err, stdout, stderr) => {
        if (err) {
          resolve({
            ok: false,
            detail: `Apple Intelligence が利用できません: ${stderr.trim().slice(0, 200) || err.message}`,
          })
        } else {
          resolve({ ok: true, detail: stdout.trim() })
        }
      })
    })
  }

  run(prompt: string): Promise<string> {
    const input = AppleAiRunner.shrink(prompt)
    return new Promise((resolve, reject) => {
      const child = execFile(
        this.binary,
        [],
        { timeout: this.timeoutMs, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            reject(new Error(`apple-ai failed: ${stderr.trim().slice(0, 500) || err.message}`))
            return
          }
          const text = stdout.trim()
          if (!text) {
            reject(new Error(`apple-ai returned empty output. stderr: ${stderr.trim().slice(0, 300)}`))
            return
          }
          resolve(text)
        },
      )
      child.stdin?.end(input)
    })
  }

  /** コンテキスト超過を避けるため、長いプロンプトの中間を省略する */
  private static shrink(prompt: string): string {
    if (prompt.length <= AppleAiRunner.MAX_PROMPT_CHARS) return prompt
    const half = Math.floor(AppleAiRunner.MAX_PROMPT_CHARS / 2)
    return (
      prompt.slice(0, half) +
      '\n…(コンテキストが長いため中略)…\n' +
      prompt.slice(prompt.length - half)
    )
  }
}

/**
 * ローカルの Ollama サーバー (http://localhost:11434) を叩くランナー。
 * モデルは指定が無ければインストール済みの先頭を使う。
 */
export class OllamaRunner implements CliRunner {
  readonly id = 'ollama'

  private resolvedModel: string | null = null

  constructor(
    private readonly baseUrl = 'http://localhost:11434',
    private readonly model?: string,
    private readonly timeoutMs = 120_000,
  ) {}

  label(): string {
    return `Ollama (${this.resolvedModel ?? this.model ?? '?'})`
  }

  async checkAvailability(): Promise<{ ok: boolean; detail: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5_000) })
      if (!res.ok) return { ok: false, detail: `Ollama 応答エラー: ${res.status}` }
      const tags = (await res.json()) as { models?: { name: string }[] }
      const names = (tags.models ?? []).map((m) => m.name)
      if (names.length === 0) {
        return { ok: false, detail: 'Ollama にモデルがありません（`ollama pull <model>` を実行）' }
      }
      if (this.model && !names.includes(this.model)) {
        return { ok: false, detail: `モデル ${this.model} が未インストール（あるもの: ${names.join(', ')}）` }
      }
      this.resolvedModel = this.model ?? names[0]
      return { ok: true, detail: `model: ${this.resolvedModel}` }
    } catch (e) {
      return {
        ok: false,
        detail: `Ollama に接続できません (${this.baseUrl}): ${e instanceof Error ? e.message : e}`,
      }
    }
  }

  async run(prompt: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.resolvedModel, prompt, stream: false }),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    if (!res.ok) {
      throw new Error(`ollama failed: ${res.status} ${(await res.text()).slice(0, 300)}`)
    }
    const json = (await res.json()) as { response?: string }
    const text = (json.response ?? '').trim()
    if (!text) throw new Error('ollama returned empty output')
    return text
  }
}
