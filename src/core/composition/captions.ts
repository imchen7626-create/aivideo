/**
 * 字幕与标题：断句、计时和画面叠加 PNG 渲染。
 * 渲染使用系统字体（Windows 上为微软雅黑），不需要随包分发字体文件。
 */

const BREAKS = /([，。！？；、,.!?;…—~～]+)/
const DROP_TRAILING = /[，。、,.;；…—~～]+$/

/** 每行最多字数（按画幅）。 */
export function captionLineChars(width: number, height: number): number {
  return width < height ? 14 : 22
}

/** 把一句旁白拆成适合逐条显示的字幕片段。 */
export function splitCaption(text: string, maxChars = 14): string[] {
  const clean = text.replace(/\s+/g, ' ').replace(/["“”「」『』]/g, '').trim()
  if (!clean) return []
  const parts: string[] = []
  const tokens = clean.split(BREAKS)
  for (let i = 0; i < tokens.length; i += 2) {
    const body = (tokens[i] ?? '').trim()
    const punct = tokens[i + 1] ?? ''
    if (!body) {
      if (punct && parts.length) parts[parts.length - 1] += punct
      continue
    }
    parts.push(body + punct)
  }
  const merged: string[] = []
  for (const piece of parts) {
    const last = merged[merged.length - 1]
    if (last && [...last].length + [...piece].length <= maxChars && /[，、,]$/.test(last))
      merged[merged.length - 1] = last + piece
    else merged.push(piece)
  }
  // Merge short neighbours first, then hard wrap phrases that are still too long.
  const wrapped: string[] = []
  for (const part of merged) {
    const chars = [...part]
    if (chars.length <= maxChars) {
      wrapped.push(part)
      continue
    }
    const pieces = Math.ceil(chars.length / maxChars)
    const size = Math.ceil(chars.length / pieces)
    // Break at word boundaries so names and words are not split across two captions.
    const words =
      typeof Intl !== 'undefined' && 'Segmenter' in Intl
        ? [...new Intl.Segmenter('zh', { granularity: 'word' }).segment(part)].map((w) => w.segment)
        : chars
    let line = ''
    for (const word of words) {
      const next = [...line].length + [...word].length
      if (line && next > size && !/^[\p{P}\s]+$/u.test(word)) {
        wrapped.push(line)
        line = ''
      }
      line += word
    }
    if (line) wrapped.push(line)
  }
  return wrapped
    .map((s) => s.replace(DROP_TRAILING, '').trim())
    .filter((s) => s.length > 0)
}

export interface CaptionCue {
  text: string
  start: number
  end: number
}

/** 按字数比例在 [0, span] 内分配每条字幕时间，最后一条保持到 holdUntil。 */
export function timeCaptions(segments: string[], span: number, holdUntil = span): CaptionCue[] {
  if (!segments.length || span <= 0) return []
  const weights = segments.map((s) => Math.max(1, [...s].length))
  const total = weights.reduce((a, b) => a + b, 0)
  let cursor = 0
  return segments.map((text, i) => {
    const start = cursor
    cursor += (span * weights[i]) / total
    const end = i === segments.length - 1 ? Math.max(cursor, holdUntil) : cursor
    return { text, start: round(start), end: round(end) }
  })
}
const round = (n: number) => Math.round(n * 1000) / 1000

export interface OverlaySpec {
  kind: 'caption' | 'title'
  text: string
  width: number
  height: number
}

const FONT = '"Microsoft YaHei","PingFang SC","Noto Sans CJK SC","Source Han Sans SC","Heiti SC",sans-serif'

function wrapTitle(text: string, maxChars: number): string[] {
  const chars = [...text.trim()]
  if (chars.length <= maxChars) return [chars.join('')]
  const half = Math.ceil(chars.length / 2)
  return [chars.slice(0, half).join(''), chars.slice(half, half * 2).join('')]
}

/** 渲染透明背景的整帧 PNG，用 FFmpeg overlay 叠加到画面上。 */
export async function renderOverlayPng(spec: OverlaySpec): Promise<Blob> {
  const { width, height } = spec
  const canvas: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height })
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) throw new Error('无法创建字幕画布')
  ctx.clearRect(0, 0, width, height)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  const portrait = width < height
  if (spec.kind === 'caption') {
    const size = Math.round(portrait ? width * 0.064 : height * 0.066)
    ctx.font = `700 ${size}px ${FONT}`
    const maxWidth = width * 0.9
    let lines = [spec.text]
    if (ctx.measureText(spec.text).width > maxWidth) lines = wrapTitle(spec.text, Math.ceil([...spec.text].length / 2))
    const lineHeight = size * 1.3
    const baseY = height * (portrait ? 0.79 : 0.87) - ((lines.length - 1) * lineHeight) / 2
    lines.forEach((line, i) => {
      const y = baseY + i * lineHeight
      ctx.shadowColor = 'rgba(0,0,0,0.55)'
      ctx.shadowBlur = size * 0.25
      ctx.lineWidth = Math.max(4, size * 0.16)
      ctx.strokeStyle = 'rgba(0,0,0,0.92)'
      ctx.strokeText(line, width / 2, y, maxWidth)
      ctx.shadowBlur = 0
      ctx.fillStyle = '#FFFFFF'
      ctx.fillText(line, width / 2, y, maxWidth)
    })
  } else {
    const lines = wrapTitle(spec.text, portrait ? 9 : 16)
    const size = Math.round(portrait ? width * 0.092 : height * 0.1)
    ctx.font = `900 ${size}px ${FONT}`
    const maxWidth = width * 0.9
    const lineHeight = size * 1.22
    const baseY = height * (portrait ? 0.14 : 0.13)
    lines.forEach((line, i) => {
      const y = baseY + i * lineHeight
      ctx.shadowColor = 'rgba(0,0,0,0.6)'
      ctx.shadowBlur = size * 0.3
      ctx.lineWidth = Math.max(6, size * 0.2)
      ctx.strokeStyle = '#111111'
      ctx.strokeText(line, width / 2, y, maxWidth)
      ctx.shadowBlur = 0
      ctx.fillStyle = i === 0 ? '#FFE14D' : '#FFFFFF'
      ctx.fillText(line, width / 2, y, maxWidth)
    })
  }
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/png' })
  return new Promise((resolve, reject) =>
    (canvas as HTMLCanvasElement).toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('字幕渲染失败'))),
      'image/png',
    ),
  )
}

/** 封面：首帧图 + 大标题，输出 JPEG。 */
export async function renderCover(image: Blob, title: string, width: number, height: number): Promise<Blob> {
  const bitmap = await createImageBitmap(image)
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  const scale = Math.max(width / bitmap.width, height / bitmap.height)
  const w = bitmap.width * scale,
    h = bitmap.height * scale
  ctx.drawImage(bitmap, (width - w) / 2, (height - h) / 2, w, h)
  const gradient = ctx.createLinearGradient(0, 0, 0, height * 0.4)
  gradient.addColorStop(0, 'rgba(0,0,0,0.55)')
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height * 0.4)
  const overlay = await createImageBitmap(await renderOverlayPng({ kind: 'title', text: title, width, height }))
  ctx.drawImage(overlay, 0, 0)
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
}
