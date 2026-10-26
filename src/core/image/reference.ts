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
import { isWorkspaceUrl, retryRateLimited, workspaceFetch } from '@/core/aliyun-workspace'

export const DEFAULT_REFERENCE_MODEL = 'qwen-image-2.0'
const PATH = '/api/v1/services/aigc/multimodal-generation/generation'
// Unwanted looks belong here, never in the positive prompt: image models read "不要腮红" as "腮红".
const NEGATIVE =
  '文字, 字幕, 水印, logo, 多余的手指, 畸形, 模糊, 低质量, 换脸, 人物外貌与参考图不一致, 正面摆拍站姿, 同一个人出现两次, 重复的人物, 看镜头, 直视镜头, 对镜头微笑, 腮红, 红脸蛋, 脸颊红晕, 面部红色色块, 浓妆, 塑料感皮肤, 僵硬表情'

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
  /** 在指令里如何称呼这张参考图，例如“角色「林」的外观参考图”。 */
  label?: string
  kind?: 'character' | 'scene' | 'previous'
}

/** 把分镜首帧 Prompt 和角色参考图组合成一条指令。 */
export function referencePrompt(prompt: string, refs: Pick<ReferenceImage, 'name' | 'label' | 'kind'>[]): string {
  const cast = refs
    .map((r, i) => `参考图${i + 1}是${r.label ?? `角色「${r.name}」的外观参考图`}`)
    .join('；')
  const scene = prompt.trim().slice(0, 850)
  // Avoid "定妆" (literally "setting makeup") in image prompts: models read it as a made-up face.
  const rules = [
    refs.some((r) => (r.kind ?? 'character') === 'character') &&
      '画面中出现的人物，其脸型五官、发型发色、服装配饰与对应外观参考图一致，只参考外观；皮肤是真实自然的素颜肤色与质感；人物的姿势、朝向、景别、机位和表情严格按本镜描述，不照搬参考图的正面全身站姿：人物正在做本镜的事，身体随动作自然侧转，视线落在动作对象或画面里的另一人身上，不看镜头，表情克制自然，本镜没写笑就不露齿大笑；每个角色在画面里只出现一次，参考图里的人就是本镜描述里的那个人，不要再额外画一个',
    refs.some((r) => r.kind === 'scene') && '环境的空间布局、陈设、主光方向和色调与场景定场图保持一致，按本镜机位重新取景',
    refs.some((r) => r.kind === 'previous') &&
      '与上一镜画面保持同一时刻的连续性：人物服装状态、道具位置、左右站位和光线不变，但按本镜的机位与景别重新构图，不要照搬上一镜',
  ].filter(Boolean)
  return `${cast}。生成一张新的电影画面：${scene}\n要求：${rules.join('；')}；不要出现任何文字、字幕或水印。`
}

/** 场次定场图：空镜交代环境，作为该场所有镜头的环境参考。 */
export function scenePlatePrompt(scene: { name: string; setting: string; lighting: string }, style: string): string {
  return `电影场景定场图（空镜），${style}。场景「${scene.name}」：${scene.setting.slice(0, 400)}。光线：${scene.lighting.slice(0, 200)}。广角全景，清楚交代空间布局与主要陈设，画面中没有人物，没有文字和水印。只画空间和固定陈设（家具、电器、门窗、灯具、装饰），台面、桌面和灶上保持整洁空置，不放食物、做好的菜和剧情道具（它们会在具体镜头里按时间出现）。`
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
  // Several shots draw at once and can hit the per-minute limit; a 429 was not billed, so wait and resend.
  let res = await retryRateLimited(() => workspaceFetch(url, init), req.signal)
  if (isWorkspaceUrl(base) && res.status === 404) res = await retryRateLimited(() => fetch('/api/bailian' + PATH, init), req.signal)
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
  return `角色外观参考照（人物设定图），${style}。角色「${c.name}」：${withoutProps(withoutFlushedFace(c.description ?? '')).slice(0, 500)}。单人，正面全身站立，双手自然下垂、手里不拿任何东西，神情放松自然，脸部清晰，素颜，真实自然的肤色与皮肤纹理，纯浅灰色无缝背景，柔和均匀的漫射光，完整展示发型、服装、鞋子与随身配饰。画面中没有文字、水印和其他人物。`
}

/**
 * 每镜出图时附上的外观要点（发型、服装、配饰），作为参考图之外的文字约束，
 * 避免同一角色在不同镜头里换了发型或衣服。
 */
export function appearanceAnchor(characters: Pick<Character, 'name' | 'description'>[]): string {
  const looks = characters
    .map((c) => {
      const parts = withoutFlushedFace(c.description ?? '')
        .split(/[，,。；;]/)
        .map((p) => p.replace(/^本场服装(为|：|:)?/, '').trim())
        // Props (a breakfast plate) are not part of a look: stated here they appear in every shot.
        .filter((p) => !/道具|随身/.test(p))
        .filter((p) => /发|衣|衫|裙|裤|鞋|靴|帽|外套|夹克|T恤|衬衫|毛衣|背心|围裙|围巾|手套|背包|挎包|手提包|包包|睡|项链|耳环|耳钉|眼镜|手表|腕表|饰/.test(p))
      return parts.length ? `${c.name}：${parts.join('，').slice(0, 90)}` : ''
    })
    .filter(Boolean)
  return looks.length ? `人物外观在每一镜都保持不变——${looks.join('；')}。` : ''
}

/** 去掉“随身道具为……”这类短句：定妆照里拿着的东西会被每一镜照搬（比如烤面包时也端着早餐盘）。 */
export function withoutProps(description: string): string {
  return description
    .split(/(?<=[，,。；;])/)
    .filter((part) => !/道具|随身/.test(part))
    .join('')
    .replace(/[，,；;]+(?=[。]|$)/g, '')
}

/**
 * 去掉描述里“脸颊泛红、红晕、眼眶发红”这类面部泛红的短句：参考照会把它画成色块，并被每一镜照搬。
 * 衣物、道具的颜色（红绳、朱红袈裟）不受影响。
 */
export function withoutFlushedFace(description: string): string {
  return description
    .split(/(?<=[，,。；;])/)
    .filter(
      (part) =>
        !/(脸|面部|面颊|面色|面庞|颊|腮|眼眶|眼圈|鼻尖|耳根|肤色|皮肤)[^，,。；;]*(红|晕)|红晕|腮红|红扑扑|泛红|晒红/.test(part),
    )
    .join('')
    .replace(/[，,；;]+(?=[。]|$)/g, '')
}

/** 挑选需要定妆的角色：主角、配角优先，按出镜次数排序，最多 4 人。 */
export function castingOrder(characters: Character[], appearances: Map<string, number>): Character[] {
  const rank = { protagonist: 0, supporting: 1, extra: 2 }
  return characters
    .filter((c) => c.role !== 'extra' && (appearances.get(c.id) ?? 0) > 0)
    .sort((a, b) => rank[a.role] - rank[b.role] || (appearances.get(b.id) ?? 0) - (appearances.get(a.id) ?? 0))
    .slice(0, 4)
}
