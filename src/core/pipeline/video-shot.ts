import { db, flushLocalStore } from '@/core/storage/db'
import { createAsset } from '@/core/storage/assets'
import { updateStoryboard } from '@/core/storage/storyboards'
import { createVideoClient } from '@/core/video/factory'
import { isWorkspaceUrl } from '@/core/aliyun-workspace'
import { getProviderCapabilityError } from '@/core/provider-capabilities'
import { shotMotionPrompt } from './continuity'
import type { CameraMovement, CameraSpeed, Provider, Storyboard } from '@/types/domain'
import type { I2VStatus, I2VTaskHandle } from '@/core/video/types'

export interface VideoShotEvent {
  shotId: string
  phase: 'submitting' | 'queued' | 'processing' | 'downloading' | 'persisting' | 'done' | 'error'
  message?: string
  progress?: number
}

interface RunOpts {
  provider: Provider
  storyboard: Storyboard
  /** 不传时取 storyboard.cameraParams，再不行就 'static'。 */
  cameraOverride?: { movement: CameraMovement; speed?: CameraSpeed }
  /** 默认 4 秒；Kling/Vidu 通常 5/10。 */
  durationSec?: number
  aspectRatio?: string
  resolution?: '480P' | '720P' | '1080P'
  /** 口型同步：配音的 oss:// 地址。 */
  audioUrl?: string
  /** 轮询间隔毫秒。默认 6000。 */
  pollIntervalMs?: number
  /** 总超时秒数。默认 600（10 分钟）。 */
  timeoutSec?: number
  signal?: AbortSignal
}

const CAMERA_PHRASES: Record<CameraMovement, string> = {
  static: 'static camera, locked-off framing',
  pan_left: 'slow camera pan to the left',
  pan_right: 'slow camera pan to the right',
  tilt_up: 'camera tilts upward',
  tilt_down: 'camera tilts downward',
  zoom_in: 'gentle zoom in',
  zoom_out: 'gentle zoom out',
  orbit_left: 'orbiting camera moves to the left around subject',
  orbit_right: 'orbiting camera moves to the right around subject',
  dolly_in: 'dolly push forward',
  dolly_out: 'dolly pull back',
}

function buildCameraInstruction(cam?: { movement: CameraMovement; speed?: CameraSpeed }): string {
  if (!cam || cam.movement === 'static') return 'static camera, no movement'
  const speedAdj = cam.speed === 'slow' ? 'very slowly, ' : cam.speed === 'fast' ? 'quickly, ' : ''
  return `${speedAdj}${CAMERA_PHRASES[cam.movement]}`
}

/**
 * 给单个分镜生成视频片段。
 * 流程：submit → poll → download blob → 落库 asset → 写回 videoAssetId.
 */
const runningShots = new Set<string>()

export async function* generateShotVideo(
  opts: RunOpts,
): AsyncGenerator<VideoShotEvent, void, void> {
  if (runningShots.has(opts.storyboard.id)) {
    yield { shotId: opts.storyboard.id, phase: 'error', message: '该镜头的视频任务正在运行。' }
    return
  }
  runningShots.add(opts.storyboard.id)
  try {
    yield* runShotVideo(opts)
  } catch (error) {
    yield {
      shotId: opts.storyboard.id,
      phase: 'error',
      message: opts.signal?.aborted
        ? '已停止等待；已提交的视频任务仍保留，下次点击继续查询。'
        : error instanceof Error
          ? error.message
          : String(error),
    }
  } finally {
    runningShots.delete(opts.storyboard.id)
  }
}

async function* runShotVideo(opts: RunOpts): AsyncGenerator<VideoShotEvent, void, void> {
  const shot = (await db.storyboards.get(opts.storyboard.id)) ?? opts.storyboard
  const configError = getProviderCapabilityError({ ...opts.provider, kind: 'image2video' })
  if (configError) {
    yield { shotId: shot.id, phase: 'error', message: configError }
    return
  }
  if (!shot.imageAssetId) {
    yield { shotId: shot.id, phase: 'error', message: '该分镜还没有起始图（先生图再生视频）' }
    return
  }

  const imageAsset = await db.assets.get(shot.imageAssetId)
  if (!imageAsset) {
    yield { shotId: shot.id, phase: 'error', message: '起始图缺失（asset 已被清理）' }
    return
  }

  yield { shotId: shot.id, phase: 'submitting' }

  const client = createVideoClient(opts.provider)
  // A storyboard video_prompt already specifies the camera; only append an explicit override.
  const camera = opts.cameraOverride ?? shot.cameraParams ?? { movement: 'static' as const }
  const cameraInstruction =
    !opts.cameraOverride && !shot.cameraParams && shot.videoPrompt ? undefined : buildCameraInstruction(camera)
  const promptParts =
    shotMotionPrompt(
      shot.videoPrompt || [shot.imagePrompt, shot.sceneText].filter(Boolean).join('. '),
      shot.edit?.exitState,
    ) +
    ' 保持人物长相、发型和服装与首帧完全一致；动作自然连贯、幅度克制，镜头稳定；画面中不出现文字、字幕和水印。'

  let handle: I2VTaskHandle
  const pending = shot.pendingVideoTask
  if (
    pending &&
    (pending.apiFlavor !== (isWorkspaceUrl(opts.provider.baseUrl) ? 'aliyun' : opts.provider.apiFlavor ?? 'openai-compatible') ||
      (pending.providerId && pending.providerId !== opts.provider.id) ||
      (pending.baseUrl && pending.baseUrl !== opts.provider.baseUrl) ||
      (pending.model && pending.model !== opts.provider.model))
  ) {
    yield {
      shotId: shot.id,
      phase: 'error',
      message: '此镜头有未完成的视频任务，请切回提交时的服务商与模型后继续查询。',
    }
    return
  }
  if (pending) {
    handle = { taskId: pending.taskId, apiFlavor: pending.apiFlavor }
  } else {
    try {
      handle = await client.submit({
        model: opts.provider.model,
        prompt: promptParts,
        imageBlob: imageAsset.blob,
        durationSec: opts.durationSec ?? shot.durationSec ?? 5,
        aspectRatio: opts.aspectRatio,
        resolution: opts.resolution,
        audioUrl: opts.audioUrl,
        cameraInstruction,
        signal: opts.signal ? AbortSignal.any([opts.signal,AbortSignal.timeout(190000)]) : AbortSignal.timeout(190000),
      })
    } catch (err) {
      // Persist before yielding: a consumer that throws on 'error' ends this generator at the yield.
      await updateStoryboard(shot.id, { status: 'failed' })
      yield {
        shotId: shot.id,
        phase: 'error',
        message: err instanceof Error ? err.message : String(err),
      }
      return
    }

    // 把 task handle 持久化，方便刷新页面恢复
    await updateStoryboard(shot.id, {
      pendingVideoTask: {
        taskId: handle.taskId,
        apiFlavor: handle.apiFlavor,
        submittedAt: Date.now(),
        providerId: opts.provider.id,
        baseUrl: opts.provider.baseUrl,
        model: opts.provider.model,
      },
    })
    await flushLocalStore()
  }

  const interval = opts.pollIntervalMs ?? 6000
  const deadline = Date.now() + (opts.timeoutSec ?? 600) * 1000

  let videoUrl: string | undefined
  let resultDuration: number | undefined
  yield { shotId: shot.id, phase: 'queued' }
  let queryFailures = 0

  while (Date.now() < deadline) {
    if (opts.signal?.aborted) {
      yield { shotId: shot.id, phase: 'error', message: '已取消' }
      return
    }
    await sleep(interval, opts.signal)
    let status: I2VStatus
    try {
      status = await client.poll(handle, opts.signal ? AbortSignal.any([opts.signal,AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000))
      queryFailures = 0
    } catch (error) {
      if (opts.signal?.aborted) throw error
      if (++queryFailures >= 3)
        throw new Error(
          `查询暂时失败，任务编号已保留，下次点击继续查询。${error instanceof Error ? error.message : ''}`,
          { cause: error },
        )
      yield { shotId: shot.id, phase: 'processing', message: '查询连接异常，正在重试原任务…' }
      continue
    }
    if (status.kind === 'queued') {
      yield { shotId: shot.id, phase: 'queued' }
      continue
    }
    if (status.kind === 'processing') {
      yield {
        shotId: shot.id,
        phase: 'processing',
        progress: status.progress,
        message: status.message,
      }
      continue
    }
    if (status.kind === 'failed') {
      // Clear the dead task first, otherwise every retry would poll it again.
      await updateStoryboard(shot.id, {
        status: 'failed',
        pendingVideoTask: undefined,
      })
      await flushLocalStore()
      yield { shotId: shot.id, phase: 'error', message: status.message }
      return
    }
    if (status.kind === 'succeeded') {
      videoUrl = status.videoUrl
      resultDuration = status.durationSec
      break
    }
  }

  if (!videoUrl) {
    yield {
      shotId: shot.id,
      phase: 'error',
      message: '等待超时，任务编号已保留，下次点击继续查询。',
    }
    return
  }

  yield { shotId: shot.id, phase: 'downloading' }

  let videoBlob: Blob
  try {
    const r = await fetch(videoUrl, { signal: opts.signal })
    if (!r.ok) throw new Error(`下载视频 HTTP ${r.status}`)
    videoBlob = await r.blob()
  } catch (err) {
    yield {
      shotId: shot.id,
      phase: 'error',
      message: err instanceof Error ? err.message : String(err),
    }
    return
  }

  yield { shotId: shot.id, phase: 'persisting' }

  // Keep previous footage for archived versions; replace only this shot's reference.

  const asset = await createAsset({
    projectId: shot.projectId,
    kind: 'video',
    blob: videoBlob,
    mimeType: videoBlob.type || 'video/mp4',
  })

  await updateStoryboard(shot.id, {
    videoAssetId: asset.id,
    status: 'video-ready',
    durationSec: resultDuration ?? shot.durationSec,
    pendingVideoTask: undefined,
  })

  yield { shotId: shot.id, phase: 'done' }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    const onAbort = () => {
      cleanup()
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
