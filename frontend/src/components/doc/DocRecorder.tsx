import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { Button, Spinner } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'
import { Mic, Square } from 'lucide-react'

/** Web Speech API の最小型（TSのDOM libに無いためここで定義） */
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult:
    | ((ev: {
        resultIndex: number
        results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
      }) => void)
    | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as
    | (new () => SpeechRecognitionLike)
    | null
}

/**
 * ドキュメントの録音メモ。MediaRecorder（音声ファイル）と SpeechRecognition
 * （文字起こし、対応ブラウザのみ）を並走させ、停止時に音声をアップロードして
 * onFinish(音声URL, 文字起こし) を返す。挿入とAI要約は呼び出し側が行う。
 */
export function DocRecorder({
  onFinish,
}: {
  onFinish: (audioUrl: string | null, transcript: string) => void
}) {
  const [recording, setRecording] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [interim, setInterim] = useState('')

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const finalTranscriptRef = useRef('')
  const recordingRef = useRef(false)

  const speechSupported = getSpeechRecognition() !== null

  const stopAll = useCallback(() => {
    recordingRef.current = false
    setRecording(false)
    recognitionRef.current?.stop()
    recognitionRef.current = null
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') rec.stop()
  }, [])

  useEffect(() => () => stopAll(), [stopAll])

  const start = useCallback(async () => {
    setError(null)
    finalTranscriptRef.current = ''
    setInterim('')
    chunksRef.current = []
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        let url: string | null = null
        if (blob.size > 0) {
          setUploading(true)
          try {
            const ext = blob.type.includes('mp4') ? 'm4a' : 'webm'
            const file = new File([blob], `recording.${ext}`, { type: blob.type })
            url = (await api.uploadFile(file)).url
          } catch (e) {
            setError(`音声の保存に失敗: ${e instanceof Error ? e.message : e}`)
          } finally {
            setUploading(false)
          }
        }
        onFinish(url, finalTranscriptRef.current.trim())
        setInterim('')
      }
      recorder.start()

      // 文字起こし（対応ブラウザのみ。途中で勝手に止まるので録音中は再起動する）
      const SR = getSpeechRecognition()
      if (SR) {
        const startRecognition = () => {
          const r = new SR()
          r.lang = 'ja-JP'
          r.continuous = true
          r.interimResults = true
          r.onresult = (ev) => {
            let interimText = ''
            for (let i = ev.resultIndex; i < ev.results.length; i++) {
              const res = ev.results[i]
              if (res.isFinal) finalTranscriptRef.current += res[0].transcript
              else interimText += res[0].transcript
            }
            setInterim(interimText)
          }
          r.onend = () => {
            if (recordingRef.current) startRecognition()
          }
          recognitionRef.current = r
          r.start()
        }
        startRecognition()
      }

      recordingRef.current = true
      setRecording(true)
    } catch (e) {
      setError(`マイクを開始できません: ${e instanceof Error ? e.message : e}`)
    }
  }, [onFinish])

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Button
        size="sm"
        variant={recording ? 'primary' : 'outline'}
        disabled={uploading}
        onClick={() => (recording ? stopAll() : void start())}
        title={
          speechSupported
            ? '録音してドキュメントに記録（文字起こし+AI要約）'
            : '録音してドキュメントに記録（このブラウザは文字起こし非対応）'
        }
      >
        {uploading ? <Spinner /> : recording ? <Square size={13} /> : <Mic size={13} />}
        {recording ? '録音停止' : uploading ? '保存中…' : '録音'}
      </Button>
      {recording && (
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-neutral-500">
          <span className={cn('h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500')} />
          {speechSupported ? (
            <span className="truncate">{interim || '認識中…'}</span>
          ) : (
            <span>録音中（文字起こし非対応ブラウザ）</span>
          )}
        </span>
      )}
      {error && <span className="truncate text-xs text-red-600">{error}</span>}
    </div>
  )
}
