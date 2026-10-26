/**
 * 贴进来的已经是分镜或剧本（较长，或带镜号、景别、首帧/运镜等分镜术语）：
 * 应按原文改编，而不是当作一句话创意让 AI 另写故事。
 */
export function looksLikeScript(text: string): boolean {
  const t = text.trim()
  return (
    t.length >= 200 ||
    /分镜|首帧|景别|运镜|机位|镜头\s*[0-9一二三四五六七八九十]|第\s*[0-9一二三四五六七八九十]+\s*[镜场幕]|(?:^|\n)\s*(?:镜头|场景|Shot)?\s*\d+\s*[.、:：]/i.test(t)
  )
}

const bare = (t: string) => t.replace(/[\s\p{P}\p{S}]/gu, '')

/** 这句台词出自用户的描述：拆成短句后每一句都能在原文里找到（标点、空格不计）。 */
export function lineFromSource(line: string, source: string): boolean {
  const text = bare(source)
  const clauses = line.split(/[\p{P}\s]+/u).map(bare).filter((c) => c.length >= 2)
  return clauses.length > 0 && clauses.every((c) => text.includes(c))
}

/** 去掉表演指示里放慢语速的要求：镜长按正常语速计算，放慢会让配音塞不进镜头。 */
export function withoutSlowPace(delivery: string): string {
  return delivery
    .split(/(?<=[，,；;。])/)
    .filter((part) => !/慢|拖长|一字一顿/.test(part))
    .join('')
    .replace(/[，,；;]+$/, '')
}

/** 描述里写了台词：引号、“某某说：”这类引语，或明确提到对白、台词。 */
export function hasDialogue(text: string): boolean {
  return /[“”"「」『』]|[说喊叫问答道讲][：:]|台词|对白|说道|喊道|大喊|喊着|说着|说了句|问道/.test(text)
}

/**
 * 用户想改一段已有的视频（MV、电影、原片里换人、“其余不变”），而生产台只能按文字重新生成画面：
 * 创建前要先说清楚，避免花钱生成一段和预期不沾边的新内容。
 */
export function referencesExistingVideo(text: string): boolean {
  return /(MV|mv|原片|原视频|电影|视频|片段|广告|名场面|镜头)[^。！？\n]{0,40}(换成|替换成?|改成|换掉)|(别的|其他|其余)(的)?(都)?(不用动|不要动|不变|保持不变)/.test(
    text,
  )
}

/** 写了人种、国籍或地域外貌（中国人、东亚面孔、欧美、混血……）。 */
export function namesEthnicity(text: string): boolean {
  return /中国|华人|华裔|东亚|亚洲|亚裔|日本|韩国|朝鲜|东南亚|印度|欧美|欧洲|西方|白人|黑人|非裔|拉丁|阿拉伯|中东|俄罗斯|混血|外国|老外|美国|英国|法国|德国|意大利|西班牙|洋人/.test(
    text,
  )
}

/**
 * 中文故事里没写人种的角色默认是中国人：不写的话出图模型会随机画成欧美长相，
 * 同一部戏的两个人也可能一中一西，和手机合照等画面对不上。
 */
export function withDefaultEthnicity(description: string, source: string): string {
  const cjk = (source.match(/[一-鿿]/g) ?? []).length
  const latin = (source.match(/[A-Za-z]/g) ?? []).length
  if (cjk <= latin || namesEthnicity(description) || namesEthnicity(source)) return description
  return `中国人，东亚面孔；${description}`
}

const pairs = (t: string) => new Set([...t].slice(1).map((c, i) => t[i] + c))
const dice = (a: string, b: string) => {
  const x = pairs(a),
    y = pairs(b)
  if (!x.size || !y.size) return 0
  let hit = 0
  for (const p of x) if (y.has(p)) hit++
  return (2 * hit) / (x.size + y.size)
}
/**
 * 模型改了一两个字的原文台词（“嗷”写成“哦”、漏一个“的”）：找回原文里最接近的那段话，
 * 而不是整句删掉。只在说话引语（“某某说：……”、引号）里找，按短句拼接匹配整句或其中一段。
 */
export function sourceLineFor(line: string, source: string): string | undefined {
  const target = bare(line)
  if (target.length < 4) return undefined
  const quotes = [
    ...source.matchAll(/[“"「『]([^”"」』]+)[”"」』]/g),
    ...source.matchAll(/[说喊叫问答道讲][：:]\s*([^\n“"「]+)/g),
  ].map((m) => m[1].trim())
  let best: { text: string; score: number } | undefined
  for (const quote of quotes) {
    const clauses = quote.split(/(?<=[，,。！？!?；;…~、])/).filter((c) => bare(c))
    for (let i = 0; i < clauses.length; i++)
      for (let j = i + 1; j <= clauses.length; j++) {
        const text = clauses.slice(i, j).join('').replace(/[，,；;、\s]+$/, '')
        const score = dice(target, bare(text))
        if (!best || score > best.score) best = { text, score }
      }
  }
  return best && best.score >= 0.6 ? best.text : undefined
}
