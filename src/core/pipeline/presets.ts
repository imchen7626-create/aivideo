import type { Provider, ProviderKind } from '@/types/domain'
import { getProviderCapabilityError } from '@/core/provider-capabilities'
import { isWorkspaceUrl } from '@/core/aliyun-workspace'

export type Duration = 15 | 30 | 60 | 90 | 120
export const DURATIONS: Duration[] = [15, 30, 60, 90, 120]
export type Resolution = '480P' | '720P' | '1080P'
export interface ProductionPreset {
  mode: 'automatic' | 'professional'
  /** drama：多场次短剧；scene：单一场景的连贯小短片。 */
  format: 'drama' | 'scene'
  durationSec: Duration
  /** fixed：成片严格等于 durationSec；storyboard：场景短片的总长由分镜按动作自然节奏决定。 */
  durationMode: 'fixed' | 'storyboard'
  resolution: Resolution
  aspectRatio: '9:16' | '16:9'
  style: string
  language: '中文' | 'English'
  budget: 'economy' | 'balanced' | 'quality'
  maxSubmissions: number
  /** auto：有语音服务（含自动复用的百炼 Key）时用后期旁白，否则保留原声。项目创建时解析为具体值。 */
  /** dialogue：角色对白分角色配音（推荐）；narration：解说式旁白；original：保留视频原声。 */
  audio: 'auto' | 'original' | 'narration' | 'dialogue'
  voice: string
  /** 把字幕烧录进 MP4 画面（发布到抖音/视频号等平台不会丢字幕）。 */
  burnSubtitles: boolean
  /** 片头前几秒叠加大标题钩子。 */
  titleCard: boolean
  /** 同时生成的镜头数（首帧与视频任务并发）。 */
  concurrency: number
  /** 角色一致性：先为主要角色生成定妆照，再用定妆照作参考图生成每镜首帧。 */
  consistency: boolean
  /** 参考图出图模型（百炼 Qwen-Image 2.0 系列）。 */
  referenceModel: string
  /** 配音模型：auto=有表演指示时用情感模型，否则标准模型；也可指定具体模型 ID。 */
  ttsModel: string
  /** 口型同步：有角色正脸台词的镜头，用配音驱动视频模型生成口型。 */
  lipSync: boolean
  /** 口型同步视频模型（万相 2.5/2.6，支持 audio_url）。 */
  lipSyncModel: string
  /** 背景音乐（素材库里的音频）与音量（0–1）。 */
  bgm?: { assetId: string; name: string; volume: number }
  providers: Partial<Record<ProviderKind, string>>
}
export const defaultPreset: ProductionPreset = {
  mode: 'automatic',
  format: 'drama',
  durationSec: 60,
  durationMode: 'fixed',
  resolution: '720P',
  aspectRatio: '9:16',
  style: '电影写实，柔和自然光，克制运镜',
  language: '中文',
  budget: 'balanced',
  maxSubmissions: 120,
  audio: 'auto',
  voice: 'Cherry',
  burnSubtitles: true,
  titleCard: true,
  concurrency: 3,
  consistency: true,
  referenceModel: 'qwen-image-2.0',
  ttsModel: 'auto',
  lipSync: true,
  lipSyncModel: 'wan2.6-i2v-flash',
  providers: {},
}
export const TTS_MODELS: { id: string; label: string }[] = [
  { id: 'auto', label: '自动 · 有表演指示时用情感模型' },
  { id: 'qwen3-tts-instruct-flash', label: 'Qwen3-TTS 情感版（按语气指示表演）' },
  { id: 'qwen3-tts-flash', label: 'Qwen3-TTS 标准版（稳定、便宜）' },
  { id: 'qwen-tts', label: 'Qwen-TTS 旧版' },
]
/** Qwen3-TTS-Flash 中文常用音色（百炼文档 2026）。 */
export const QWEN_VOICES: { id: string; label: string }[] = [
  { id: 'Cherry', label: '芊悦 · 阳光亲切女声' },
  { id: 'Serena', label: '苏瑶 · 温柔女声' },
  { id: 'Ethan', label: '晨煦 · 温暖活力男声' },
  { id: 'Elias', label: 'Elias · 讲故事女声' },
  { id: 'Ryan', label: 'Ryan · 戏剧张力男声' },
  { id: 'Katerina', label: 'Katerina · 成熟御姐' },
  { id: 'Moon', label: 'Moon · 率性帅气男声' },
  { id: 'Maia', label: 'Maia · 知性温柔女声' },
  { id: 'Kai', label: 'Kai · 沉稳舒缓男声' },
  { id: 'Neil', label: 'Neil · 播报男声' },
  { id: 'Eldric Sage', label: 'Eldric · 沉稳长者' },
  { id: 'Chelsie', label: '千雪 · 二次元少女' },
  { id: 'Vivian', label: 'Vivian · 可爱小暴躁女声' },
  { id: 'Momo', label: 'Momo · 俏皮撒娇女声' },
  { id: 'Mochi', label: 'Mochi · 机灵少年音' },
  { id: 'Vincent', label: 'Vincent · 沙哑烟嗓男声' },
  { id: 'Andre', label: 'Andre · 磁性沉稳男声' },
  { id: 'Arthur', label: 'Arthur · 质朴老人' },
  { id: 'Bunny', label: 'Bunny · 萌系小女孩' },
  { id: 'Pip', label: 'Pip · 调皮小男孩' },
  { id: 'Nini', label: 'Nini · 软糯甜妹' },
]
export function isQwenTts(provider?: Pick<Provider, 'model' | 'apiFlavor' | 'baseUrl'>): boolean {
  return !!provider && (/qwen.*tts|cosyvoice/i.test(provider.model) || provider.apiFlavor === 'bailian')
}
/** 成片总长由分镜决定（只对场景短片生效；短剧仍按固定时长编排）。 */
export function storyboardTimed(preset: Pick<ProductionPreset, 'format' | 'durationMode'>): boolean {
  return preset.format === 'scene' && preset.durationMode === 'storyboard'
}
export function normalizePreset(input: Partial<ProductionPreset> = {}): ProductionPreset {
  return {
    ...defaultPreset,
    ...input,
    format: input.format === 'scene' ? 'scene' : 'drama',
    durationSec: DURATIONS.includes(input.durationSec as Duration) ? (input.durationSec as Duration) : 60,
    durationMode: input.durationMode === 'storyboard' ? 'storyboard' : 'fixed',
    resolution: ['480P', '720P', '1080P'].includes(input.resolution ?? '') ? input.resolution! : '720P',
    // 60 was the old default and is too low once casting and voice are included.
    maxSubmissions: Math.max(10, Math.min(200, Math.floor(Number(input.maxSubmissions) === 60 ? 120 : Number(input.maxSubmissions) || 120))),
    audio: ['auto', 'original', 'narration', 'dialogue'].includes(input.audio ?? '') ? input.audio! : 'auto',
    burnSubtitles: input.burnSubtitles ?? true,
    titleCard: input.titleCard ?? true,
    concurrency: Math.max(1, Math.min(4, Math.floor(Number(input.concurrency) || 3))),
    consistency: input.consistency ?? true,
    referenceModel: (input.referenceModel ?? '').trim() || 'qwen-image-2.0',
    ttsModel: (input.ttsModel ?? '').trim() || 'auto',
    lipSync: input.lipSync ?? true,
    lipSyncModel: (input.lipSyncModel ?? '').trim() || 'wan2.6-i2v-flash',
    bgm:
      input.bgm && typeof input.bgm.assetId === 'string'
        ? { ...input.bgm, volume: Math.max(0.05, Math.min(0.8, Number(input.bgm.volume) || 0.22)) }
        : undefined,
    providers: input.providers ?? {},
  }
}
export function readPreset(): ProductionPreset {
  try {
    return normalizePreset(JSON.parse(localStorage.getItem('studio-preset') ?? '{}'))
  } catch {
    return { ...defaultPreset }
  }
}
/** 设置页统一管理的专用模型覆盖到本次运行（项目预设里的旧字段只作兼容）。 */
export function applyModelSettings(
  preset: ProductionPreset,
  models?: { tts?: string; reference?: string; lipSync?: string },
): ProductionPreset {
  if (!models) return preset
  return {
    ...preset,
    ttsModel: models.tts?.trim() || preset.ttsModel,
    referenceModel: models.reference?.trim() || preset.referenceModel,
    lipSyncModel: models.lipSync?.trim() || preset.lipSyncModel,
  }
}
export function resolveProviders(
  preset: ProductionPreset,
  providers: Provider[],
  active: Partial<Record<ProviderKind, string>>,
): Partial<Record<ProviderKind, Provider>> {
  const resolved: Partial<Record<ProviderKind, Provider>> = Object.fromEntries(
    (['llm', 'text2image', 'image2video', 'imageEdit', 'tts'] as ProviderKind[]).map((kind) => [
      kind,
      providers.find((p) => p.kind === kind && p.id === (preset.providers[kind] || active[kind])),
    ]),
  )
  if (!resolved.tts) resolved.tts = deriveBailianTts([resolved.image2video, resolved.text2image, ...providers])
  return resolved
}
/**
 * 没有单独配置语音时，复用已配置的阿里云百炼 Key 调用 Qwen3-TTS。
 * 只派生、不写入设置；用户在设置里添加语音服务后以用户配置为准。
 */
export function deriveBailianTts(candidates: (Provider | undefined)[]): Provider | undefined {
  const source = candidates.find(
    (p) =>
      !!p?.apiKey.trim() &&
      p.kind !== 'llm' &&
      (p.apiFlavor === 'bailian' || p.baseUrl.trim() === '/api/bailian' || isWorkspaceUrl(p.baseUrl)),
  )
  if (!source) return undefined
  return {
    id: 'auto-bailian-tts',
    label: '百炼语音（自动复用 Key）',
    kind: 'tts',
    baseUrl: isWorkspaceUrl(source.baseUrl) ? new URL(source.baseUrl).origin : '/api/bailian',
    apiKey: source.apiKey,
    model: 'qwen3-tts-flash',
    apiFlavor: 'bailian',
  }
}
/** 把 audio:auto 解析为项目实际使用的声音模式。 */
export function resolveAudio(
  preset: ProductionPreset,
  providers: Partial<Record<ProviderKind, Provider>>,
): ProductionPreset {
  if (preset.audio !== 'auto') return preset
  const narration = !!providers.tts
  return {
    ...preset,
    audio: narration ? 'dialogue' : 'original',
    voice: narration && isQwenTts(providers.tts) && !QWEN_VOICES.some((v) => v.id === preset.voice) ? 'Cherry' : preset.voice,
  }
}
export function preflight(
  preset: ProductionPreset,
  providers: Partial<Record<ProviderKind, Provider>>,
): string[] {
  const kinds: ProviderKind[] = [
    'llm',
    'text2image',
    'image2video',
    ...(usesVoice(preset) ? ['tts' as const] : []),
  ]
  const labels = {
    llm: '文本',
    text2image: '图像',
    image2video: '视频',
    imageEdit: '图片编辑',
    tts: '语音',
  }
  const errors = kinds.flatMap((kind) => {
    const p = providers[kind]
    if (!p) return [`请配置并激活${labels[kind]}模型`]
    return [
      !p.model.trim()
        ? `${labels[kind]}模型名称为空`
        : !p.baseUrl.trim()
          ? `${labels[kind]}接口地址为空`
          : getProviderCapabilityError(p),
    ].filter((s): s is string => !!s)
  })
  const video = providers.image2video
  if (video && preset.aspectRatio === '16:9' && /bailian|aliyun/.test(video.apiFlavor ?? ''))
    errors.push('当前阿里视频适配器按竖屏请求，请选择 9:16 或更换支持横屏的适配器')
  return errors
}
/** Conservative adapter limits, not claims about unimplemented upstream features. */
export function videoDurations(provider: Provider): number[] {
  if (provider.apiFlavor === 'bailian') return [5]
  if (provider.apiFlavor === 'kling') return [5, 10]
  // Any whole second is accepted (HappyHorse 3–15s, wan2.7 2–15s, wan3.0 2–30s): generate close to the
  // cut length instead of trimming a fixed 5s clip, and keep shots short enough for one clear action.
  if (/^(?:happyhorse-|wan2\.7-|wan3\.0-)/.test(provider.model)) return [3, 4, 5, 6, 7, 8]
  if (/wan2[.-]2|wan2[.-]1/.test(provider.model)) return [5]
  if (provider.apiFlavor === 'aliyun' || /wan/.test(provider.model)) return [5, 10]
  if (provider.apiFlavor === 'volcengine') return [5, 6, 7, 8, 9, 10]
  return [5]
}

/** 是否需要后期配音（对白或旁白）。 */
export function usesVoice(preset: Pick<ProductionPreset, 'audio'>): boolean {
  return preset.audio === 'narration' || preset.audio === 'dialogue'
}

/** 角色音色候选：按性别与年龄段排序，分配时尽量让每个角色声音不同。 */
const VOICE_POOL: Record<string, string[]> = {
  'female-young': ['Cherry', 'Serena', 'Maia', 'Chelsie', 'Vivian', 'Momo'],
  'female-adult': ['Katerina', 'Maia', 'Serena', 'Elias'],
  'female-elder': ['Katerina', 'Elias'],
  'male-young': ['Ethan', 'Moon', 'Kai', 'Ryan', 'Mochi'],
  'male-adult': ['Ryan', 'Kai', 'Neil', 'Vincent', 'Andre'],
  'male-elder': ['Eldric Sage', 'Arthur', 'Neil'],
  child: ['Bunny', 'Pip', 'Nini'],
}
export const NARRATOR_VOICE = 'Elias'
export function pickVoices(
  characters: { id: string; gender?: string; age?: string; voice?: string }[],
): Record<string, string> {
  const used = new Set(characters.map((c) => c.voice).filter(Boolean) as string[])
  used.add(NARRATOR_VOICE)
  const out: Record<string, string> = {}
  for (const c of characters) {
    if (c.voice) {
      out[c.id] = c.voice
      continue
    }
    const key =
      c.age === 'child'
        ? 'child'
        : `${c.gender === 'male' ? 'male' : 'female'}-${c.age === 'elder' ? 'elder' : c.age === 'adult' ? 'adult' : 'young'}`
    const pool = VOICE_POOL[key] ?? VOICE_POOL['female-young']
    const voice = pool.find((v) => !used.has(v)) ?? pool[0]
    used.add(voice)
    out[c.id] = voice
  }
  return out
}

/** 口型同步视频服务：复用已配置的百炼视频服务与 Key，换成支持音频驱动的模型。 */
export function lipSyncProvider(video: Provider | undefined, model: string): Provider | undefined {
  if (!video?.apiKey.trim()) return undefined
  const base = video.baseUrl.trim().replace(/\/+$/, '')
  if (isWorkspaceUrl(base)) return { ...video, id: video.id + ':lipsync', model, apiFlavor: 'aliyun' }
  if (base === '/api/bailian' || video.apiFlavor === 'bailian')
    return { ...video, id: video.id + ':lipsync', baseUrl: '/api/bailian', model, apiFlavor: 'aliyun' }
  return undefined
}
