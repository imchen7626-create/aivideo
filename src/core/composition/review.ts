import type { Storyboard } from '@/types/domain'
import { getEditedDuration } from './plan'

/** Actionable checks for human review; never claims visual identity recognition. */
export function reviewStoryboard(shots: Storyboard[]): string[] {
  const issues: string[] = [],
    ordered = [...shots].sort((a, b) => a.sequence - b.sequence)
  for (const [i, shot] of ordered.entries()) {
    if ((shot.narration?.replace(/\s/g, '').length ?? 0) > getEditedDuration(shot) * 4)
      issues.push(`镜头${shot.sequence}：对白/字幕偏密，需试听语速`)
    if (!shot.edit?.entryState || !shot.edit.exitState)
      issues.push(`镜头${shot.sequence}：缺少入出状态，需人工核对动作和道具连续性`)
    if (!shot.direction?.sourceExcerpt)
      issues.push(`镜头${shot.sequence}：旧版分镜没有原文定位，需核对改编因果`)
    const next = ordered[i + 1]
    if (
      next &&
      shot.direction?.scene === next.direction?.scene &&
      shot.edit?.exitState &&
      next.edit?.entryState &&
      shot.edit.exitState !== next.edit.entryState
    )
      issues.push(
        `镜头${shot.sequence}→${next.sequence}：入出状态描述不同，预览核对动作、视线和站位`,
      )
  }
  return issues
}
