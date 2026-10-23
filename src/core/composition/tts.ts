import type { Provider } from '@/types/domain'
import { isWorkspaceUrl, workspaceFetch } from '@/core/aliyun-workspace'

export interface TtsRequest {
  model: string
  /** 中文/英文文本。 */
  text: string
  /** OpenAI："alloy"/"nova"；Qwen-TTS："Cherry"/"Ethan" 等。 */
  voice?: string
  /** "mp3" / "wav" / "ogg"。仅 OpenAI 兼容接口使用。 */
  format?: 'mp3' | 'wav' | 'ogg'
  speed?: number
  /** Qwen-TTS 的 language_type：Chinese / English / Auto。 */
  language?: string
  /** 表演指示（情绪、语气、语速）。有值时使用 qwen3-tts-instruct-flash，失败自动回退普通模型。 */
  instructions?: string
  signal?: AbortSignal
}

type TtsProvider = Pick<Provider, 'baseUrl' | 'apiKey'> & Partial<Pick<Provider, 'model' | 'apiFlavor'>>

/** 阿里云百炼 Qwen-TTS / CosyVoice：走本机代理，复用百炼 Key。 */
export function isDashScopeTts(provider: TtsProvider, model?: string): boolean {
  const base = provider.baseUrl.trim().replace(/\/+$/, '')
  return (
    base === '/api/bailian' ||
    isWorkspaceUrl(base) ||
    (provider.apiFlavor === 'bailian' && /qwen.*tts|cosyvoice/i.test(model ?? provider.model ?? ''))
  )
}

/** 有表演指示时先用 instruct 模型做情感配音；账号不支持（4xx）时回退普通模型，不阻塞出片。 */
async function dashScopeTts(provider: TtsProvider, req: TtsRequest): Promise<Blob> {
  if (req.instructions?.trim())
    try {
      return await dashScopeTtsOnce(provider, {
        ...req,
        model: /instruct/i.test(req.model) ? req.model : 'qwen3-tts-instruct-flash',
      })
    } catch (e) {
      if (req.signal?.aborted || !/HTTP 4\d\d/.test(String(e))) throw e
    }
  return dashScopeTtsOnce(provider, {
    ...req,
    model: /instruct/i.test(req.model) ? 'qwen3-tts-flash' : req.model,
    instructions: undefined,
  })
}

async function dashScopeTtsOnce(provider: TtsProvider, req: TtsRequest): Promise<Blob> {
  if (!provider.apiKey.trim()) throw new Error('请填写阿里云百炼 API Key 后再生成旁白。')
  const base = provider.baseUrl.trim().replace(/\/+$/, '')
  const path = '/api/v1/services/aigc/multimodal-generation/generation'
  const url = isWorkspaceUrl(base) ? new URL(base).origin + path : '/api/bailian' + path
  const body = JSON.stringify({
    model: req.model || 'qwen3-tts-flash',
    input: {
      text: req.text,
      voice: req.voice || 'Cherry',
      language_type: req.language === 'English' ? 'English' : req.language === 'Auto' ? 'Auto' : 'Chinese',
      ...(req.instructions?.trim()
        ? { instructions: req.instructions.trim().slice(0, 300), optimize_instructions: true }
        : {}),
    },
  })
  const init = (): RequestInit => ({
    method: 'POST',
    headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
    body,
    signal: req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
  })
  const official = '/api/bailian' + path
  type Reply = {
    code?: string
    message?: string
    error?: { code?: string; message?: string } | string
    output?: { audio?: { url?: string; data?: string } }
  }
  const call = async (target: string) => {
    const res = target === official ? await fetch(target, init()) : await workspaceFetch(target, init())
    const json = !!res.headers.get('content-type')?.includes('application/json')
    // A successful non-JSON page means the request never reached the proxy (old or missing local
    // server). Error pages from the provider or its gateway are handled by status below, so the
    // workspace → official and instruct → plain fallbacks still get their chance.
    if (res.ok && !json) throw new Error('本地百炼服务未启动或版本过旧，请重启生产台后再试。')
    const text = await res.text()
    let data: Reply = {}
    if (json)
      try {
        data = JSON.parse(text) as Reply
      } catch {
        /* keep raw text for the message */
      }
    const err = typeof data.error === 'string' ? data.error : data.error?.message || data.error?.code
    const raw = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)
    return { res, data, detail: data.message || data.code || err || raw || '请求失败' }
  }
  // 429 (rate limit, not billed) and gateway 5xx are transient: back off and retry the same request.
  const withBackoff = async (target: string) => {
    for (let attempt = 0; ; attempt++) {
      const r = await call(target)
      const status = r.res.status
      if (!(status === 429 ? attempt < 5 : status >= 500 && attempt < 2)) return r
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, 2000 * 2 ** attempt)
        req.signal?.addEventListener('abort', () => {
          clearTimeout(t)
          reject(req.signal!.reason)
        })
      })
    }
  }
  let r = await withBackoff(url)
  // 业务空间域名不支持该语音模型/路由时（4xx 拒绝，未受理），改走同一 Key 的北京地域官方接口。
  if (url !== official && [400, 403, 404].includes(r.res.status)) {
    const fallback = await withBackoff(official)
    if (fallback.res.ok && !fallback.data.code) r = fallback
    else r = { ...fallback, detail: `业务空间：${r.detail}；官方接口：${fallback.detail}` }
  }
  const { res, data } = r
  if (!res.ok || data.code)
    throw new Error(`百炼语音（${req.model || 'qwen3-tts-flash'}，音色 ${req.voice || 'Cherry'}）HTTP ${res.status}：${r.detail}`)
  const audio = data.output?.audio
  if (audio?.data) {
    const binary = atob(audio.data)
    return new Blob([Uint8Array.from(binary, (c) => c.charCodeAt(0))], { type: 'audio/wav' })
  }
  if (!audio?.url) throw new Error('百炼语音没有返回音频地址。')
  const file = await fetch(`/api/bailian/media?url=${encodeURIComponent(audio.url)}`, { signal: req.signal })
  if (!file.ok) {
    const why = await file.text().catch(() => '')
    throw new Error(`旁白已生成但下载失败（下载 ${file.status}${why ? '：' + why.slice(0, 120) : ''}），请继续制作重试。`)
  }
  const blob = await file.blob()
  if (blob.size < 64) throw new Error('百炼语音返回空音频，请检查音色。')
  return blob.type.startsWith('audio/') ? blob : new Blob([blob], { type: 'audio/wav' })
}

/**
 * 生成单句旁白。
 * - 百炼（/api/bailian 或业务空间域名）：Qwen3-TTS-Flash，返回 24kHz WAV。
 * - 其他：OpenAI 兼容 `${baseUrl}/audio/speech`。
 */
export async function generateTtsAudio(provider: TtsProvider, req: TtsRequest): Promise<Blob> {
  if (!req.text.trim()) throw new Error('旁白为空')
  if (isDashScopeTts(provider, req.model)) return dashScopeTts(provider, req)
  const url = `${provider.baseUrl.replace(/\/+$/, '')}/audio/speech`
  const body: Record<string, unknown> = {
    model: req.model,
    input: req.text,
    voice: req.voice ?? 'alloy',
    response_format: req.format ?? 'mp3',
  }
  if (req.speed) body.speed = req.speed

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: req.signal,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`TTS HTTP ${res.status}: ${detail.slice(0, 200)}`)
  }
  const mime = res.headers.get('Content-Type') ?? ''
  if (!/audio\//i.test(mime) && !mime.includes('application/octet-stream'))
    throw new Error('语音服务没有返回音频，请检查是否配置为独立的 Speech 接口。')
  const blob = await res.blob()
  if (blob.size < 32) throw new Error('语音服务返回空音频，请检查模型和音色。')
  return blob
}
