import { execFile } from 'node:child_process'

export interface CliRunner {
  readonly id: string
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
