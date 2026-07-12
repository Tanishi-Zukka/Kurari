import type { AiJob } from './types.js'

export interface RunnerInfo {
  id: string
  label: string
}

export class ApiClient {
  constructor(
    private readonly server: string,
    private readonly token?: string,
    /** 利用可能な実行エンジン一覧。ページ側のセレクタ表示用にheartbeatで通知する */
    private readonly runners: RunnerInfo[] = [],
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.token) h.Authorization = `Bearer ${this.token}`
    return h
  }

  async heartbeat(): Promise<void> {
    const res = await fetch(`${this.server}/api/agent/heartbeat`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ runners: this.runners }),
    })
    if (!res.ok) throw new Error(`heartbeat failed: ${res.status}`)
  }

  /** pending ジョブを1件 claim。無ければ null */
  async claimJob(): Promise<AiJob | null> {
    const res = await fetch(`${this.server}/api/agent/jobs/claim`, {
      method: 'POST',
      headers: this.headers(),
    })
    if (res.status === 204) return null
    if (!res.ok) throw new Error(`claim failed: ${res.status}`)
    return (await res.json()) as AiJob
  }

  async completeJob(id: string, body: { result?: string; error?: string }): Promise<void> {
    const res = await fetch(`${this.server}/api/agent/jobs/${id}/complete`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`complete failed: ${res.status}`)
  }
}
