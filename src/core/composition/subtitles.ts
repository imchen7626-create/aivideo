import type { Storyboard } from '@/types/domain'
import { getEditedDuration } from './plan'
import { splitCaption, timeCaptions } from './captions'

function cues(shots: Storyboard[]) {
  let cursor = 0
  const out: { start: number; end: number; text: string }[] = []
  for (const s of [...shots].sort((a, b) => a.sequence - b.sequence)) {
    const dur = getEditedDuration(s)
    if (s.narration?.trim())
      for (const c of timeCaptions(splitCaption(s.narration), dur))
        out.push({ start: cursor + c.start, end: cursor + c.end, text: c.text })
    cursor += dur
  }
  return out
}

/**
 * 把分镜列表的 narration（旁白）+ durationSec 转成 SRT / VTT。
 * 时间轴按顺序拼出，没有 narration 的分镜会被跳过编号。
 */
export function buildSrt(shots: Storyboard[]): string {
  return cues(shots)
    .map((c, i) => `${i + 1}\n${secondsToSrtTime(c.start)} --> ${secondsToSrtTime(c.end)}\n${c.text}\n`)
    .join('\n')
}

export function buildVtt(shots: Storyboard[]): string {
  return ['WEBVTT', '', ...cues(shots).map((c) => `${secondsToVttTime(c.start)} --> ${secondsToVttTime(c.end)}\n${c.text}\n`)].join('\n')
}

function secondsToSrtTime(s: number): string {
  const totalMs = Math.round(s*1000)
  const h = Math.floor(totalMs / 3600000)
  const m = Math.floor((totalMs % 3600000) / 60000)
  const sec = Math.floor(totalMs % 60000 / 1000)
  const ms = totalMs % 1000
  return `${pad2(h)}:${pad2(m)}:${pad2(sec)},${pad3(ms)}`
}

function secondsToVttTime(s: number): string {
  const totalMs = Math.round(s*1000)
  const h = Math.floor(totalMs / 3600000)
  const m = Math.floor((totalMs % 3600000) / 60000)
  const sec = Math.floor(totalMs % 60000 / 1000)
  const ms = totalMs % 1000
  return `${pad2(h)}:${pad2(m)}:${pad2(sec)}.${pad3(ms)}`
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
function pad3(n: number): string {
  return String(n).padStart(3, '0')
}
