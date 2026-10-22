/**
 * 镜头之间的衔接：分镜给每镜写了起始状态（entryState）和结束状态（exitState），
 * 这里把它们落到首帧与视频提示词里，让上一镜的结束画面就是下一镜的开始。
 */

/** directing 在模型缺字段时填的占位语，不是真实状态，不写进提示词。 */
const PLACEHOLDERS = new Set(['承接上一镜', '动作完成'])

const usable = (state?: string) => {
  const s = state?.trim()
  return s && !PLACEHOLDERS.has(s) ? s : undefined
}

/** 首帧只画动作开始前的那一瞬间，否则视频会从“结果”倒着演。 */
export function firstFramePrompt(prompt: string, entryState?: string): string {
  const entry = usable(entryState)
  return entry
    ? `本镜首帧是动作开始之前的静止瞬间，人物与道具状态：${entry}。只画这一瞬间，不要画出本镜后续动作的结果；与下文描述冲突时以此状态为准。\n${prompt}`
    : prompt
}

/** 视频收在结束状态上，下一镜从这里接。 */
export function shotMotionPrompt(prompt: string, exitState?: string): string {
  const exit = usable(exitState)
  return exit ? `${prompt.trim().replace(/[。.]?$/, '。')}镜头结束时的画面：${exit}。` : prompt
}
