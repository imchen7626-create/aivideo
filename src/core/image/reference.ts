/**
 * 角色一致性：定妆照 + 参考图出图（阿里云百炼 Qwen-Image 2.0 系列）。
 *
 * 协议（百炼官方文档 qwen-image-edit-api，2026）：
 *   POST {业务空间域名 或 /api/bailian}/api/v1/services/aigc/multimodal-generation/generation
 *   { model, input:{ messages:[{ role:'user', content:[{image},{image},{text}] }] },
 *     parameters:{ n:1, size:'928*1664', prompt_extend:false, watermark:false, negative_prompt } }
 *   → output.choices[0].message.content[].image（PNG，24 小时有效）
 * 每次 1–3 张参考图，支持 data URI；size 总像素 512²–2048²、16 的倍数。
 */
import type { Character, Provider } from '@/types/domain'
import { isWorkspaceUrl, workspaceFetch } from '@/core/aliyun-workspace'

export const DEFAULT_REFERENCE_MODEL = 'qwen-image-2.0'
const PATH = '/api/v1/services/aigc/multimodal-generation/generation'
const NEGATIVE =
  '文字, 字幕, 水印, logo, 多余的手指, 畸形, 模糊, 低质量, 换脸, 人物外貌与参考图不一致'

/** 已配置的百炼图像服务（官方转发或业务空间域名）可以直接用同一 Key 做参考图出图。 */
export function referenceProvider(
  image: Provider | undefined,
  model = DEFAULT_REFERENCE_MODEL,
): Provider | undefined {
  if (!image?.apiKey.trim()) return undefined
  const bailian =
    image.apiFlavor === 'bailian' ||
    image.baseUrl.trim().replace(/\/+$/, '') === '/api/bailian' ||
    isWorkspaceUrl(image.baseUrl)
  return bailian ? { ...image, model: model.trim() || DEFAULT_REFERENCE_MODEL } : undefined
}

export function referenceSize(aspectRatio: string, resolution = '720P'): string {
  const [w, h] = resolution === '1080P' ? [1088, 1920] : [928, 1664]
  return aspectRatio === '16:9' ? `${h}*${w}` : `${w}*${h}`
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`
}

export interface ReferenceImage {
  name: string
  blob: Blob
  /** 在指令里如何称呼这张参考图，例如“角色「林」的定妆照”。 */
  label?: string
  kind?: 'character' | 'scene' | 'previous'
}

/** 把分镜首帧 Prompt 和角色参考图组合成一条指令。 */
export function referencePrompt(prompt: string, refs: Pick<ReferenceImage, 'name' | 'label' | 'kind'>[]): string {
  const cast = refs
    .map((r, i) => `参考图${i + 1}是${r.label ?? `角色「${r.name}」的定妆照`}`)
    .join('；')
  const scene = prompt.trim().slice(0, 850)
  const rules = [
    refs.some((r) => (r.kind ?? 'character') === 'character') &&
      '画面中出现的人物，其脸型五官、发型发色、肤色、服装配饰必须与对应定妆照完全一致，只参考外观，不照搬定妆照的姿势和背景',
    refs.some((r) => r.kind === 'scene') && '环境的空间布局、陈设、主光方向和色调与场景定场图保持一致，按本镜机位重新取景',
    refs.some((r) => r.kind === 'previous') && '与上一镜画面保持同一时刻的连续性：人物服装状态、道具位置和光线不变',
  ].filter(Boolean)
  return `${cast}。生成一张新的电影画面：${scene}\n要求：${rules.join('；')}；不要出现任何文字、字幕或水印。`
}

/** 场次定场图：空镜交代环境，作为该场所有镜头的环境参考。 */
export function scenePlatePrompt(scene: { name: string; setting: string; lighting: string }, style: string): string {
  return `电影场景定场图（空镜），${style}。场景「${scene.name}」：${scene.setting.slice(0, 400)}。光线：${scene.lighting.slice(0, 200)}。广角全景，清楚交代空间布局与主要陈设，画面中没有人物，没有文字和水印。`
}

export async function generateWithReferences(
  provider: Pick<Provider, 'baseUrl' | 'apiKey' | 'model'>,
  req: { prompt: string; references: ReferenceImage[]; size: string; signal?: AbortSignal },
): Promise<Blob> {
  const base = provider.baseUrl.trim().replace(/\/+$/, '')
  const url = isWorkspaceUrl(base) ? new URL(base).origin + PATH : '/api/bailian' + PATH
  const refs = req.references.slice(0, 3)
  const content: Record<string, string>[] = []
  for (const r of refs) {
    if (r.blob.size > 10 * 1024 * 1024) throw new Error(`角色「${r.name}」参考图超过 10MB，请在角色页更换`)
    content.push({ image: await blobToDataUrl(r.blob) })
  }
  content.push({ text: refs.length ? referencePrompt(req.prompt, refs) : req.prompt.slice(0, 1200) })
  const init: RequestInit = {
    method: 'POST',
    headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: provider.model || DEFAULT_REFERENCE_MODEL,
      input: { messages: [{ role: 'user', content }] },
      parameters: {
        n: 1,
        size: req.size,
        prompt_extend: false,
        watermark: false,
        negative_prompt: NEGATIVE,
      },
    }),
    signal: req.signal
      ? AbortSignal.any([req.signal, AbortSignal.timeout(190000)])
      : AbortSignal.timeout(190000),
  }
  let res = await workspaceFetch(url, init)
  if (isWorkspaceUrl(base) && res.status === 404) res = await fetch('/api/bailian' + PATH, init)
  if (!res.headers.get('content-type')?.includes('application/json'))
    throw new Error('本地百炼服务未启动或版本过旧，请重启生产台。')
  const data = (await res.json()) as {
    code?: string
    message?: string
    output?: { choices?: { message?: { content?: { image?: string }[] } }[] }
  }
  if (!res.ok || data.code)
    throw new Error(
      `百炼参考图出图（${provider.model}）HTTP ${res.status}：${data.message || data.code || '请求失败'}。若账号未开通该模型，可在“高级”里更换角色一致性出图模型，或取消勾选“角色一致性”后继续。`,
    )
  const image = data.output?.choices?.[0]?.message?.content?.find((c) => c.image)?.image
  if (!image) throw new Error('百炼参考图出图没有返回图片')
  const file = await fetch(`/api/bailian/media?url=${encodeURIComponent(image)}`, { signal: req.signal })
  if (!file.ok) throw new Error(`图片已生成但下载失败（HTTP ${file.status}），请继续制作重试`)
  const blob = await file.blob()
  return blob.type.startsWith('image/') ? blob : new Blob([blob], { type: 'image/png' })
}

/** 定妆照：单人、全身、纯色背景，便于后续每镜作为参考。 */
export function castingPrompt(c: Pick<Character, 'name' | 'description'>, style: string): string {
  return `角色定妆照，${style}。角色「${c.name}」：${(c.description ?? '').slice(0, 500)}。单人，正面全身站立，双手自然下垂，表情自然，脸部清晰，纯浅灰色无缝背景，柔和均匀的影棚光，完整展示发型、服装、鞋子与随身配饰。画面中不要文字、水印或其他人物。`
}

/** 挑选需要定妆的角色：主角、配角优先，按出镜次数排序，最多 4 人。 */
export function castingOrder(characters: Character[], appearances: Map<string, number>): Character[] {
  const rank = { protagonist: 0, supporting: 1, extra: 2 }
  return characters
    .filter((c) => c.role !== 'extra' && (appearances.get(c.id) ?? 0) > 0)
    .sort((a, b) => rank[a.role] - rank[b.role] || (appearances.get(b.id) ?? 0) - (appearances.get(a.id) ?? 0))
    .slice(0, 4)
}
