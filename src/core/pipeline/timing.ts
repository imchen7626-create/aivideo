/**
 * 镜头时长求解器。
 *
 * 语言模型不擅长精确算术：让它直接给出“合计严格 60 秒”的镜长，常见结果是 56 秒或 75 秒，
 * 然后整份分镜被判失败、重新付费生成。这里改为：模型只给出每镜的建议镜长（节奏意图），
 * 由程序在约束内求解出准确的成片时长：
 *   - 每镜下限：有台词时 ≥ 台词字数 / 语速 + 呼吸；无台词 ≥ 最短可读镜长
 *   - 每镜上限：视频模型单段可生成的最长素材
 *   - 总和：严格等于目标时长（按 25fps 帧对齐）
 * 然后为每镜挑选最短的、能覆盖成片镜长的素材时长，入点为 0。
 *
 * 不传目标时长（场景短片“由分镜决定”）时，每镜就用建议镜长（夹在可行范围内），总长随内容而定。
 */

export const EDIT_FPS = 25
/** 中文旁白语速（字/秒）。配音最多还能再自动加速 1.35 倍，这里按保守值规划。 */
export const SPEECH_CHARS_PER_SEC = 4.2
export const MIN_SHOT_SEC = 1.6
const BREATH_SEC = 0.3

export interface TimingInput {
  /** 模型给的建议成片镜长（可能缺失或离谱）。 */
  desiredSec?: number
  narration?: string
  /** 连续镜头链的中段：成片必须用满整段素材，首尾帧才能无缝相接。 */
  exact?: boolean
}
export interface TimingResult {
  ok: true
  shots: { trimInSec: number; trimOutSec: number; materialSec: number }[]
  totalSec: number
}
export interface TimingFailure {
  ok: false
  /** 给模型的具体修改意见（按镜号）。 */
  issues: string[]
}

export const speechChars = (text = '') => text.replace(/[\s\p{P}]/gu, '').length

/** 这句旁白至少需要多长的镜头。 */
export function minShotSec(narration?: string, charsPerSec = SPEECH_CHARS_PER_SEC): number {
  const chars = speechChars(narration)
  return Math.max(MIN_SHOT_SEC, chars ? chars / charsPerSec + BREATH_SEC : 0)
}
/** 语速上限：略密的旁白先按稍快语速排，仍在配音自动加速的余量之内。 */
export const FAST_CHARS_PER_SEC = 4.8

const frames = (sec: number) => Math.round(sec * EDIT_FPS)

export function fitShotTiming(
  shots: TimingInput[],
  targetSec: number | undefined,
  materialDurations: number[],
): TimingResult | TimingFailure {
  const normal = fitAtRate(shots, targetSec, materialDurations, SPEECH_CHARS_PER_SEC)
  if (normal.ok) return normal
  const fast = fitAtRate(shots, targetSec, materialDurations, FAST_CHARS_PER_SEC)
  return fast.ok ? fast : normal
}

function fitAtRate(
  shots: TimingInput[],
  targetSec: number | undefined,
  materialDurations: number[],
  rate: number,
): TimingResult | TimingFailure {
  const allowed = [...materialDurations].sort((a, b) => a - b)
  const maxSec = allowed[allowed.length - 1]
  const issues: string[] = []
  if (!shots.length) return { ok: false, issues: ['没有镜头'] }
  const lo = shots.map((s) => minShotSec(s.narration, rate))
  lo.forEach((need, i) => {
    if (need > maxSec) {
      const budget = Math.floor((maxSec - BREATH_SEC) * rate)
      issues.push(
        `镜头${i + 1}：旁白${speechChars(shots[i].narration)}字，单镜最长${maxSec}秒只能容纳约${budget}字，请精简或拆成两镜`,
      )
    }
  })
  if (issues.length) return { ok: false, issues }
  if (targetSec === undefined) return freeTiming(shots, lo, allowed)
  const hi = shots.map((s, i) => {
    if (!s.exact) return maxSec
    const d = allowed.find((x) => x >= lo[i]) ?? maxSec
    lo[i] = d
    return d
  })
  const minTotal = lo.reduce((a, b) => a + b, 0)
  const maxTotal = hi.reduce((a, b) => a + b, 0)
  if (minTotal > targetSec) {
    const over = minTotal - targetSec
    const chars = Math.ceil(over * rate)
    const heavy = shots
      .map((s, i) => ({ i, n: speechChars(s.narration) }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 4)
      .map((x) => `镜头${x.i + 1}(${x.n}字)`)
    return {
      ok: false,
      issues: [
        `旁白总量超出${targetSec}秒成片容量约${over.toFixed(1)}秒：请把全部旁白合计删减至少${chars}字（优先精简 ${heavy.join('、')}），或减少镜头数量`,
      ],
    }
  }
  if (maxTotal < targetSec)
    return {
      ok: false,
      issues: [
        `${shots.length}个镜头即使每镜都用满也只有${maxTotal}秒，不足${targetSec}秒：请增加${Math.ceil((targetSec - maxTotal) / maxSec)}个以上镜头`,
      ],
    }
  // Desired durations express rhythm; clamp into each shot's feasible range.
  const want = shots.map((s, i) => {
    const d = Number(s.desiredSec)
    return Number.isFinite(d) && d > 0 ? d : (lo[i] + maxSec) / 2
  })
  const total = (k: number) =>
    want.reduce((sum, w, i) => sum + Math.min(hi[i], Math.max(lo[i], w * k)), 0)
  // total(k) is monotonic in k: bisect for the scale that hits the target.
  let a = 0,
    b = 1
  while (total(b) < targetSec && b < 1e6) b *= 2
  for (let n = 0; n < 60; n++) {
    const m = (a + b) / 2
    if (total(m) < targetSec) a = m
    else b = m
  }
  const sec = want.map((w, i) => Math.min(hi[i], Math.max(lo[i], w * b)))
  // Frame-align and push the rounding remainder onto shots that still have room.
  const f = sec.map(frames)
  const minF = lo.map((x) => Math.ceil(x * EDIT_FPS))
  const maxF = hi.map(frames)
  let diff = frames(targetSec) - f.reduce((x, y) => x + y, 0)
  for (let guard = 0; diff !== 0 && guard < 10000; guard++) {
    const order = f
      .map((_, i) => i)
      .sort((x, y) => (diff > 0 ? f[x] - f[y] : f[y] - f[x]))
    const i = order.find((k) => (diff > 0 ? f[k] < maxF[k] : f[k] > minF[k]))
    if (i === undefined) break
    f[i] += diff > 0 ? 1 : -1
    diff += diff > 0 ? -1 : 1
  }
  if (diff !== 0) return { ok: false, issues: ['镜头时长无法精确对齐到目标时长，请调整镜头数量'] }
  return {
    ok: true,
    totalSec: f.reduce((x, y) => x + y, 0) / EDIT_FPS,
    shots: f.map((n) => {
      const out = n / EDIT_FPS
      return { trimInSec: 0, trimOutSec: out, materialSec: allowed.find((d) => d >= out - 1e-9) ?? maxSec }
    }),
  }
}

/** 无目标总长：每镜取建议镜长（缺失时取 4 秒），不短于台词所需；接力中段用满整段素材。 */
function freeTiming(shots: TimingInput[], lo: number[], allowed: number[]): TimingResult {
  const maxSec = allowed[allowed.length - 1]
  const f = shots.map((s, i) => {
    const d = Number(s.desiredSec)
    const want = Math.min(maxSec, Math.max(lo[i], Number.isFinite(d) && d > 0 ? d : 4))
    const sec = s.exact ? (allowed.find((x) => x >= want - 1e-9) ?? maxSec) : want
    return Math.max(Math.ceil(lo[i] * EDIT_FPS), Math.min(frames(maxSec), frames(sec)))
  })
  return {
    ok: true,
    totalSec: f.reduce((x, y) => x + y, 0) / EDIT_FPS,
    shots: f.map((n) => {
      const out = n / EDIT_FPS
      return { trimInSec: 0, trimOutSec: out, materialSec: allowed.find((d) => d >= out - 1e-9) ?? maxSec }
    }),
  }
}

/** 节拍时长不配平到总时长，只取整并夹在合理范围内（场景短片“由分镜决定”）。 */
export function clampBeatSeconds(seconds: number[], minSec = 2, maxSec = 20): number[] {
  return seconds.map((s) => Math.max(minSec, Math.min(maxSec, Math.round(Number.isFinite(s) && s > 0 ? s : 5))))
}

/** 剧情节拍时长按比例归一到目标总时长（整数秒），不因模型算错几秒就判整份方案失败。 */
export function normalizeBeatSeconds(seconds: number[], targetSec: number): number[] {
  const safe = seconds.map((s) => (Number.isFinite(s) && s > 0 ? s : 1))
  const sum = safe.reduce((a, b) => a + b, 0)
  const raw = safe.map((s) => (s / sum) * targetSec)
  const out = raw.map((x) => Math.max(1, Math.floor(x)))
  let rest = targetSec - out.reduce((a, b) => a + b, 0)
  const order = raw.map((x, i) => [x - Math.floor(x), i] as const).sort((p, q) => q[0] - p[0])
  for (let k = 0; rest > 0; k = (k + 1) % out.length, rest--) out[order[k][1]]++
  for (let k = 0; rest < 0; k = (k + 1) % out.length) {
    const i = order[order.length - 1 - k][1]
    if (out[i] > 1) {
      out[i]--
      rest++
    }
  }
  return out
}
