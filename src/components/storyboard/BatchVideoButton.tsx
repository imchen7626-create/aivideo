import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Film, Loader2, StopCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useProjectProvider } from '@/core/pipeline/use-project-provider'
import { db } from '@/core/storage/db'
import { generateShotVideo, type VideoShotEvent } from '@/core/pipeline/video-shot'
import type { Storyboard } from '@/types/domain'

interface Props {
  projectId: string
}

interface Progress {
  total: number
  done: number
  failed: number
  current?: number
  phase?: VideoShotEvent['phase']
}

export function BatchVideoButton({ projectId }: Props) {
  const provider = useProjectProvider('image2video',projectId)
  const shots = useLiveQuery<Storyboard[], Storyboard[]>(
    async () =>
      db.storyboards
        .where('[projectId+sequence]')
        .between([projectId, -Infinity], [projectId, Infinity], true, true)
        .toArray(),
    [projectId],
    [],
  )

  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  if (!provider || shots.length === 0) return null

  const targets = shots.filter((s) => s.imageAssetId && !s.videoAssetId)
  const ready = shots.filter((s) => s.imageAssetId).length

  const stop = () => {
    abortRef.current?.abort()
    setRunning(false)
  }

  const start = async () => {
    if (targets.length === 0) return
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setProgress({ total: targets.length, done: 0, failed: 0 })

    let done = 0
    let failed = 0
    let next = 0
    const worker = async () => {
    while (next < targets.length) {
      const i = next++
      if (controller.signal.aborted) break
      const shot = targets[i]
      setProgress({
        total: targets.length,
        done,
        failed,
        current: shot.sequence,
        phase: 'submitting',
      })
      try {
        let lastError: string | undefined
        for await (const ev of generateShotVideo({
          provider,
          storyboard: shot,
          signal: controller.signal,
        })) {
          setProgress({
            total: targets.length,
            done,
            failed,
            current: shot.sequence,
            phase: ev.phase,
          })
          if (ev.phase === 'error') lastError = ev.message
        }
        if (lastError) failed++
        else done++
      } catch (err) {
        failed++
        if (err instanceof Error && err.name === 'AbortError') break
      }
    }
    }
    await Promise.all(Array.from({length:Math.min(3,targets.length)},()=>worker()))

    setRunning(false)
    abortRef.current = null
    setProgress({ total: targets.length, done, failed })
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {running ? (
        <Button variant="destructive" onClick={stop} className="gap-2">
          <StopCircle className="h-4 w-4" /> 中止
        </Button>
      ) : (
        <Button
          onClick={start}
          disabled={targets.length === 0}
          variant="secondary"
          className="gap-2"
        >
          <Film className="h-4 w-4" />
          {targets.length > 0
              ? `批量生视频（剩 ${targets.length}，最多 3 镜并行）`
            : ready > 0
              ? '所有分镜已有视频'
              : '先批量生图再生视频'}
        </Button>
      )}
      {running && progress && (
        <span className="flex items-center gap-2 text-xs text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {progress.done}/{progress.total} 完成
          {progress.failed > 0 && (
            <span className="text-destructive">· 失败 {progress.failed}</span>
          )}
          {progress.current !== undefined && (
            <span>
              · 当前 #{String(progress.current).padStart(2, '0')}
              {progress.phase ? ` (${progress.phase})` : ''}
            </span>
          )}
        </span>
      )}
    </div>
  )
}
