import type { Provider } from '@/types/domain'
import type { I2VClient, I2VRequest, I2VStatus, I2VTaskHandle } from '@/core/video/types'
import { isWorkspaceUrl, workspaceFetch, workspaceModel, workspaceMedia } from '@/core/aliyun-workspace'

const ALLOWED_DURATIONS = [3, 4, 5, 10, 15] as const

type InputFormat = 'media' | 'img_url'
const FORMAT_KEY = 'dramai-video-input-format'

/** 首帧字段格式：官方新协议模型放 input.media，其余（含 302 中转）放 input.img_url。 */
function knownFormat(model: string, official: boolean): InputFormat {
  return official && /^(?:wan3\.0-|wan2\.7-|happyhorse-)/.test(model) ? 'media' : 'img_url'
}

/** 接口因缺少首帧字段而拒收时，返回应改用的格式。 */
export function formatFromRejection(status: number, text: string): InputFormat | undefined {
  if (status !== 400 || !/required|missing|必填|缺少|不能为空/i.test(text)) return
  if (/\bmedia\b/i.test(text)) return 'media'
  if (/img_url/i.test(text)) return 'img_url'
}

function rememberedFormat(model: string): InputFormat | undefined {
  try {
    const v = (JSON.parse(localStorage.getItem(FORMAT_KEY) ?? '{}') as Record<string, unknown>)[model]
    return v === 'media' || v === 'img_url' ? v : undefined
  } catch {
    return undefined
  }
}

/** 记住与内置判断不同的格式；与内置一致时清除记录。 */
function rememberFormat(model: string, format: InputFormat | undefined) {
  try {
    const all = JSON.parse(localStorage.getItem(FORMAT_KEY) ?? '{}') as Record<string, unknown>
    if (all[model] === format) return
    if (format) all[model] = format
    else delete all[model]
    localStorage.setItem(FORMAT_KEY, JSON.stringify(all))
  } catch {
    // 无法持久化时下次再按拒收信息切换一次
  }
}

const RESOLUTIONS = ['480P', '720P', '1080P'] as const
type Resolution = (typeof RESOLUTIONS)[number]
const RESOLUTION_KEY = 'dramai-video-min-resolution'

/** 已知不提供 480P 的模型（wan2.6、wan2.7 只有 720P/1080P）。 */
function knownMinResolution(model: string): Resolution | undefined {
  return /^wan2\.[67]-/.test(model) ? '720P' : undefined
}

/** 接口拒绝分辨率时（“resolution 480P is not supported, available ones are ['720P', '1080P']”）返回最低可用档。 */
export function resolutionFromRejection(text: string): Resolution | undefined {
  const m = /resolution\s+\S+\s+is not supported[^[]*\[([^\]]*)\]/i.exec(text)
  return m ? RESOLUTIONS.find((r) => m[1].toUpperCase().includes(r)) : undefined
}

function rememberedMinResolution(model: string): Resolution | undefined {
  try {
    const v = (JSON.parse(localStorage.getItem(RESOLUTION_KEY) ?? '{}') as Record<string, unknown>)[model]
    return RESOLUTIONS.find((r) => r === v)
  } catch {
    return undefined
  }
}

function rememberMinResolution(model: string, min: Resolution) {
  try {
    const all = JSON.parse(localStorage.getItem(RESOLUTION_KEY) ?? '{}') as Record<string, unknown>
    all[model] = min
    localStorage.setItem(RESOLUTION_KEY, JSON.stringify(all))
  } catch {
    // 无法持久化时下次再按拒收信息改一次
  }
}

/** 选了模型不支持的低分辨率时，改用它支持的最低一档。 */
function fitResolution(model: string, requested: Resolution): Resolution {
  const min = rememberedMinResolution(model) ?? knownMinResolution(model)
  return min && RESOLUTIONS.indexOf(requested) < RESOLUTIONS.indexOf(min) ? min : requested
}

/**
 * 阿里云通义万相（DashScope）图生视频客户端。
 *
 * 协议（来自 302.AI 上 wan2.7-i2v 产品页 OpenAPI Spec，2026-05 验证）：
 *
 *   POST {baseUrl}/aliyun/api/v1/services/aigc/video-generation/video-synthesis
 *     header: Authorization: Bearer ...
 *             X-DashScope-Async: enable    （阿里官方协议要求异步任务带这个头）
 *     body: {
 *       model: "wan2.2-i2v-flash" | "wan2.2-i2v-plus" | "wan2.7-i2v" | ...,
 *       input: {
 *         prompt: "<prompt + camera instruction>",
 *         img_url: "data:image/png;base64,..." | "https://...",
 *         negative_prompt?: "...",
 *         audio_url?: "..."
 *       },
 *       parameters: {
 *         resolution: "480P" | "720P" | "1080P",
 *         duration: 3 | 4 | 5 | 10 | 15,
 *         prompt_extend: true,
 *         watermark: false
 *       }
 *     }
 *     resp: {
 *       request_id, output: { task_id, task_status: "PENDING" }
 *     }
 *
 *   GET  {baseUrl}/aliyun/api/v1/tasks/{task_id}
 *     resp: {
 *       request_id,
 *       output: {
 *         task_id, task_status: "PENDING"|"RUNNING"|"SUCCEEDED"|"FAILED"|"CANCELED"|"UNKNOWN",
 *         video_url?: "https://...",   // SUCCEEDED 时
 *         message?, code?
 *       }
 *     }
 *
 * Base URL 应该指向 302 root：`https://api.302ai.cn`（默认走 .cn 中转避开 CORS 坑）。
 *
 * Spec 明确支持 img_url 用 base64 dataURL（"输入方式 2"），dramai 直接发本地 Blob 转 dataURL，无需图床。
 *
 * **价格（2026-05）**：
 *   wan2.2-i2v-flash    480P 0.02 PTC/秒  720P 0.04 PTC/秒  ← 性价比之王
 *   wan2.2-i2v-plus     480P 0.03 PTC/秒  1080P 0.15 PTC/秒
 *   wan2.5-i2v-preview  480P 0.05 PTC/秒  720P 0.10 PTC/秒  1080P 0.16 PTC/秒（支持音频）
 *   wan2.7-i2v          720P 0.10 PTC/秒  1080P 0.15 PTC/秒（最新）
 */
export function createAliyunClient(
  provider: Pick<Provider, 'baseUrl' | 'apiKey' | 'model'>,
): I2VClient {
  const root = provider.baseUrl.replace(/\/+$/, '')
  // '/api/bailian' = 本机转发到北京官方域名；业务空间域名同样按官方协议处理。
  const local = root === '/api/bailian'
  const official = isWorkspaceUrl(root) || local
  const apiRoot = local ? root : isWorkspaceUrl(root) ? new URL(root).origin : `${root}/aliyun`

  return {
    async submit(req: I2VRequest): Promise<I2VTaskHandle> {
      const promptText = [req.prompt, req.cameraInstruction]
        .filter((s): s is string => Boolean(s && s.trim()))
        .join('. ')
      const imageDataUrl = await blobToDataURL(req.imageBlob)

      const model = official ? workspaceModel(req.model || provider.model,'video') : req.model || provider.model
      const duration = sanitizeDuration(req.durationSec ?? 5, model)
      let resolution = fitResolution(model, req.resolution ?? '720P')
      const buildBody = (format: InputFormat): Record<string, unknown> => {
        if (format === 'media') {
          const media: Array<{ type: string; url: string }> = [{ type: 'first_frame', url: imageDataUrl }]
          // wan2.7 drives lip sync with the voice as a media item instead of audio_url.
          if (req.audioUrl && model.startsWith('wan2.7-')) media.push({ type: 'driving_audio', url: req.audioUrl })
          const parameters: Record<string, unknown> = model.startsWith('wan3.0-')
            ? { resolution, duration, ratio: 'adaptive', prompt_extend: false }
            : model.startsWith('happyhorse-')
              ? // HappyHorse: ratio follows the image; watermark defaults on.
                { resolution, duration, watermark: false }
              : model.startsWith('wan2.7-')
                ? { resolution, duration, prompt_extend: false, watermark: false }
                : { resolution, duration, watermark: false }
          return { model, input: { prompt: promptText, media }, parameters }
        }
        const body: Record<string, unknown> = {
          model,
          input: {
            prompt: promptText,
            img_url: imageDataUrl,
          },
          parameters: {
            resolution,
            duration,
            // The storyboard prompt is already specific; rewriting it adds actions the cut did not plan.
            prompt_extend: false,
            watermark: false,
          },
        }
        // Audio-driven lip sync (wan2.5 / wan2.6): the model animates the face to the supplied voice.
        if (req.audioUrl) (body.input as Record<string, unknown>).audio_url = req.audioUrl
        // wan2.6 i2v generates its own soundtrack unless told not to.
        else if (/^wan2\.[56]/.test(model)) (body.parameters as Record<string, unknown>).audio = false
        return body
      }

      const known = knownFormat(model, official)
      let format = rememberedFormat(model) ?? known
      let res: Response
      for (let attempt = 0; ; attempt++) {
        try {
          res = await workspaceFetch(`${apiRoot}/api/v1/services/aigc/video-generation/video-synthesis`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
              'X-DashScope-Async': 'enable',
              ...(req.audioUrl?.startsWith('oss://') ? { 'X-DashScope-OssResourceResolve': 'enable' } : {}),
            },
            body: JSON.stringify(buildBody(format)),
            signal: req.signal,
          })
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') throw err
          const msg = err instanceof Error ? err.message : String(err)
          throw new Error(
            `${msg} · 可能是 CORS 拦截：请求大概率已送达 302 并扣 token，但浏览器拿不到响应。建议：(1) base URL 切到 https://api.302ai.cn 国内中转；(2) 去 302 后台对账，必要时申诉退款；(3) 暂停继续点击，避免再次扣费`,
            { cause: err },
          )
        }
        if (res.ok) break
        const text = (await safeText(res)).slice(0, 280)
        // A rejected parameter (first-frame field, resolution) creates no task, so one corrected
        // resend is safe.
        const needed = attempt === 0 ? formatFromRejection(res.status, text) : undefined
        const fitted = attempt === 0 ? resolutionFromRejection(text) : undefined
        if (needed && needed !== format) format = needed
        else if (fitted && fitted !== resolution) {
          rememberMinResolution(model, fitted)
          resolution = fitted
        } else throw new Error(`Aliyun submit HTTP ${res.status}: ${text}`)
      }
      rememberFormat(model, format === known ? undefined : format)
      const json = (await res.json()) as {
        output?: { task_id?: string; task_status?: string }
        request_id?: string
      }
      const taskId = json.output?.task_id
      if (!taskId) {
        throw new Error('Aliyun submit 响应里没找到 output.task_id')
      }
      return { taskId, apiFlavor: 'aliyun' }
    },

    async poll(handle: I2VTaskHandle, signal?: AbortSignal): Promise<I2VStatus> {
      const res = await workspaceFetch(`${apiRoot}/api/v1/tasks/${encodeURIComponent(handle.taskId)}`, {
        headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {},
        signal,
      })
      if (!res.ok) {
        throw new Error(`Aliyun poll HTTP ${res.status}: ${(await safeText(res)).slice(0, 200)}`)
      }
      const json = (await res.json()) as {
        output?: {
          task_status?: string
          video_url?: string
          message?: string
          code?: string
          results?: Array<{ url?: string; video_url?: string }>
        }
      }
      const status = (json.output?.task_status ?? '').toUpperCase()

      if (status === 'SUCCEEDED' || status === 'SUCCESS') {
        const url =
          json.output?.video_url ??
          json.output?.results?.[0]?.video_url ??
          json.output?.results?.[0]?.url
        if (!url) {
          return {
            kind: 'failed',
            message:
              'Aliyun: 任务成功但响应里没找到 video_url（output.video_url 与 output.results[].url 都没值）',
          }
        }
        return { kind: 'succeeded', videoUrl: official?workspaceMedia(url):url }
      }
      if (status === 'FAILED' || status === 'CANCELED') {
        const message = json.output?.message ?? `任务${status.toLowerCase()}`
        // Some endpoints accept the task and only reject the first-frame field while running:
        // remember the right format so the next retry submits it correctly.
        const model = official ? workspaceModel(provider.model, 'video') : provider.model
        const known = knownFormat(model, official)
        const needed = formatFromRejection(400, message)
        if (needed && needed !== (rememberedFormat(model) ?? known)) {
          rememberFormat(model, needed === known ? undefined : needed)
          return {
            kind: 'failed',
            message: `${message}（首帧格式不匹配，已改用 ${needed === 'media' ? 'input.media' : 'input.img_url'} 格式，点“继续制作”会按新格式重新提交）`,
          }
        }
        const fitted = resolutionFromRejection(message)
        if (fitted) {
          rememberMinResolution(model, fitted)
          return { kind: 'failed', message: `${message}（该模型不支持所选分辨率，之后改用 ${fitted} 提交）` }
        }
        return { kind: 'failed', message }
      }
      if (status === 'RUNNING') return { kind: 'processing' }
      // PENDING / UNKNOWN / 空都按 queued 处理
      return { kind: 'queued' }
    },
  }
}

function sanitizeDuration(d: number, model: string): number {
  // HappyHorse（3–15 秒）与 wan2.7（2–15 秒）接受任意整秒
  if (/^(?:happyhorse-|wan2\.7-)/.test(model)) return Math.min(15, Math.max(3, Math.ceil(d - 0.01)))
  // 找最近的合法值
  let best = ALLOWED_DURATIONS[0] as number
  let bestDiff = Math.abs(d - best)
  for (const v of ALLOWED_DURATIONS) {
    const diff = Math.abs(d - v)
    if (diff < bestDiff) {
      best = v
      bestDiff = diff
    }
  }
  return best
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

async function blobToDataURL(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`
}
