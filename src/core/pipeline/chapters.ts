export interface Chapter { id: string; title: string; text: string }

/** Keep preface with the first chapter; repeated cover/table headings do not create empty episodes. */
export function splitChapters(text: string): Chapter[] {
  const source = text.replace(/\r\n?/g, '\n').trim()
  if (!source) return []
  const explicitHeading = /^(?:第\s*[零〇一二三四五六七八九十百千万两\d]+\s*[章节回集幕卷][\s：:、.．-]*.*|(?:chapter|episode)\s+\d+.*)$/i
  const clean = (line: string) => line.trim().replace(/^#{1,6}\s+/, '')
  const lines = source.split('\n')
  const hasExplicit = lines.some(line => explicitHeading.test(clean(line)))
  const isHeading = (line: string) => hasExplicit ? explicitHeading.test(clean(line)) : /^#{1,2}\s+.+/.test(line.trim())
  const canonical = (title: string) => {
    const compact = title.replace(/[\s：:、.．-]/g, '').toLowerCase()
    return compact.match(/^(?:第[零〇一二三四五六七八九十百千万两\d]+[章节回集幕卷]|(?:chapter|episode)\d+)/)?.[0] ?? compact
  }
  const groups: { title: string; lines: string[] }[] = []
  let current = { title: '章节 01', lines: [] as string[] }
  let foundHeading = false
  for (const line of lines) {
    if (isHeading(line)) {
      const title = clean(line)
      if (!foundHeading) {
        current.title = title
        current.lines.push(line)
        foundHeading = true
      } else if (canonical(title) === canonical(current.title)) current.lines.push(line)
      else {
        groups.push(current)
        current = { title, lines: [line] }
      }
    } else current.lines.push(line)
  }
  if (current.lines.some(l => l.trim())) groups.push(current)
  return groups.map((g, i) => ({ id: `chapter-${i + 1}`, title: g.title, text: g.lines.join('\n').trim() }))
}

export interface PublishCopy { title: string; description: string; hashtags: string[] }
export interface DramaPlan { logline: string; hook: string; ending: string; beats: { title: string; description: string; durationSec: number }[]; /** 片头大标题，≤14 字。 */ title?: string; /** 发布平台的标题、简介与话题。 */ publish?: PublishCopy }
export function validatePlan(value: unknown): DramaPlan {
  const p = value as DramaPlan
  if (!p || typeof p.logline !== 'string' || typeof p.hook !== 'string' || typeof p.ending !== 'string' || !Array.isArray(p.beats) || p.beats.length !== 6) throw new Error('方案格式错误：需要六个剧情节拍。')
  if (p.beats.some(b => !b || typeof b.title !== 'string' || typeof b.description !== 'string' || !Number.isFinite(b.durationSec) || b.durationSec <= 0) || p.beats.reduce((s, b) => s + b.durationSec, 0) !== 60) throw new Error('方案时长必须合计 60 秒，每个节拍时长需大于零。')
  return p
}
