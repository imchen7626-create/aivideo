import type { Provider } from '../types/domain'
import type { T2IRequest, T2IResult } from './image/types'
import type { I2VClient } from './video/types'

type Config = Pick<Provider, 'baseUrl' | 'apiKey' | 'model'>
interface Reply {
  code?: string
  message?: string
  output?: {
    task_id?: string
    task_status?: string
    video_url?: string
    message?: string
    choices?: Array<{ message?: { content?: Array<{ image?: string }> } }>
  }
}

function root(provider: Config) {
  if (!provider.apiKey.trim()) throw new Error('请在模型设置中填写阿里云百炼 API Key。')
  if (provider.baseUrl.replace(/\/+$/, '') !== '/api/bailian') {
    throw new Error('百炼官方接入地址请填写 /api/bailian，并通过项目本地启动器打开。')
  }
  return '/api/bailian'
}

async function request(
  provider: Config,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<Reply> {
  const url = `${root(provider)}${path}`
  let res: Response
  try {
    res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(190000)])
        : AbortSignal.timeout(190000),
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error(
      body
        ? '生成请求的连接中断，任务可能已受理。请先在百炼控制台核实，避免重复提交。'
        : '查询连接中断，将继续查询原视频任务。',
      { cause: error },
    )
  }
  if (!res.headers.get('content-type')?.includes('application/json')) {
    throw new Error('本地百炼服务未启动或版本过旧，请重新运行项目本地启动器。')
  }
  const data = (await res.json()) as Reply
  if (!res.ok || data.code) {
    throw new Error(
      data.code === 'AllocationQuota.FreeTierOnly'
        ? '百炼免费额度已用完；请在百炼控制台确认是否启用按量付费。'
        : `百炼 HTTP ${res.status}：${data.message || data.code || '请求失败'}`,
    )
  }
  return data
}

export function bailianMediaUrl(url: string): string {
  return `/api/bailian/media?url=${encodeURIComponent(url)}`
}

export async function generateBailianImage(provider: Config, req: T2IRequest): Promise<T2IResult> {
  if ((req.model || provider.model) !== 'z-image-turbo')
    throw new Error('当前百炼文生图接入支持 z-image-turbo。')
  if (req.referenceImages?.length)
    throw new Error(
      'Z-Image-Turbo 不支持参考图。请解除角色参考图锁定，或选择支持参考图的生图模型。',
    )
  if ((req.n ?? 1) !== 1) throw new Error('Z-Image-Turbo 每次生成一张图。')
  if ([...req.prompt].length > 800)
    throw new Error('Z-Image-Turbo 提示词不能超过 800 字符，请缩短该分镜描述。')
  const data = await request(
    provider,
    '/api/v1/services/aigc/multimodal-generation/generation',
    {
      model: 'z-image-turbo',
      input: { messages: [{ role: 'user', content: [{ text: req.prompt }] }] },
      parameters: { size: (req.size || '720x1280').replace('x', '*'), prompt_extend: false },
    },
    req.signal,
  )
  const url = data.output?.choices?.[0]?.message?.content?.find((c) => c.image)?.image
  if (!url) throw new Error('百炼响应未包含图片。')
  const res = await fetch(bailianMediaUrl(url), { signal: req.signal })
  if (!res.ok)
    throw new Error(`图片已生成但下载失败（HTTP ${res.status}），请先到百炼控制台核实再重试。`)
  const blob = await res.blob()
  return { images: [{ blob, mimeType: blob.type || 'image/png' }] }
}

export function createBailianVideoClient(provider: Config): I2VClient {
  return {
    async submit(req) {
      if ((req.model || provider.model) !== 'wan2.2-i2v-flash')
        throw new Error('当前百炼视频接入支持 wan2.2-i2v-flash。')
      if ((req.durationSec ?? 5) !== 5)
        throw new Error('Wan2.2 Flash 每镜固定 5 秒，请先调整镜头时长。')
      if (
        !['image/png', 'image/jpeg', 'image/webp', 'image/bmp'].includes(req.imageBlob.type) ||
        req.imageBlob.size > 10 * 1024 * 1024
      ) {
        throw new Error('起始图须为 PNG、JPEG、WebP 或 BMP，且不超过 10MB。')
      }
      const bytes = new Uint8Array(await req.imageBlob.arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
      const data = await request(
        provider,
        '/api/v1/services/aigc/video-generation/video-synthesis',
        {
          model: 'wan2.2-i2v-flash',
          input: {
            prompt: [req.prompt, req.cameraInstruction].filter(Boolean).join('. '),
            img_url: `data:${req.imageBlob.type};base64,${btoa(binary)}`,
          },
          // wan2.2-i2v-flash 支持 480P/720P；选 1080P 时按 720P 生成。
          parameters: { resolution: req.resolution === '480P' ? '480P' : '720P', duration: 5, prompt_extend: false },
        },
        req.signal,
      )
      if (!data.output?.task_id) throw new Error('百炼未返回任务编号，请到控制台核实后再提交。')
      return { taskId: data.output.task_id, apiFlavor: 'bailian' }
    },
    async poll(handle, signal) {
      const data = await request(
        provider,
        `/api/v1/tasks/${encodeURIComponent(handle.taskId)}`,
        undefined,
        signal,
      )
      const output = data.output
      switch (output?.task_status) {
        case 'PENDING':
          return { kind: 'queued' }
        case 'RUNNING':
          return { kind: 'processing' }
        case 'SUCCEEDED':
          if (!output.video_url) throw new Error('任务成功但未返回视频地址，请到百炼控制台核实。')
          return { kind: 'succeeded', videoUrl: bailianMediaUrl(output.video_url), durationSec: 5 }
        case 'FAILED':
        case 'CANCELED':
          return { kind: 'failed', message: output.message || '百炼视频任务失败或取消。' }
        default:
          throw new Error('百炼任务状态未知或已过期，请到控制台核实；不会自动重新提交。')
      }
    },
  }
}
