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

/**
 * 出图模型参考的是全身站立的定妆照，“躺在床上”常被画成坐在床上：把躺姿说具体。
 * 只在入状态写了躺（且没写坐起、起身）时追加。
 */
function lyingNote(entry: string): string {
  return /躺|卧床|睡着|熟睡|蜷在被/.test(entry) && !/坐起|起身|站起/.test(entry)
    ? '写“躺”或“睡”的人物整个身体平躺或侧躺着，头靠在枕头或垫子上，不是坐着或靠坐着。'
    : ''
}

/** 首帧只画动作开始前的那一瞬间，否则视频会从“结果”倒着演。 */
export function firstFramePrompt(prompt: string, entryState?: string): string {
  const entry = usable(entryState)
  return entry
    ? `本镜首帧是动作开始之前的静止瞬间。人物姿势与道具状态只按这一句：${entry}。${lyingNote(entry)}下文只用来确定构图、景别、服装、环境和光线；下文写到的动作、手势和结果此刻都还没有发生，不要画出来。\n${prompt}`
    : prompt
}

/** 画面里不出现任何登记角色（空镜、远景景物、主观视野）：此时不能给出图模型角色定妆照，否则会把人画进去。 */
export function showsNoCharacters(prompt = ''): boolean {
  return /无人物|没有人物|不出现人物|画面中没有人|无人出镜|空镜|\bno (?:people|person|humans?)\b/i.test(prompt)
}

/** 主观镜头：画面是观看者看到的景象，观看者本人不出镜。 */
export function povNote(viewer: string): string {
  return `这是${viewer}的主观视角：画面是${viewer}看到的景象，${viewer}本人不出现在画面中（最多露出手或望远镜等器物的边缘）。`
}

/** 口型镜头不跟随运镜：去掉“镜头横移/跟移/拉远……”这类短句，只留人物动作（极缓推近保留）。 */
export function withoutCameraMoves(prompt: string): string {
  return prompt
    .split(/(?<=[，,；;。])/)
    .filter((part) => !/镜头[^，,；;。]*(横移|平移|跟移|跟拍|环绕|摇|拉远|拉开|后拉|升降|移动)/.test(part))
    .join('')
}
/** 视频收在结束状态上，下一镜从这里接。 */
export function shotMotionPrompt(prompt: string, exitState?: string): string {
  const exit = usable(exitState)
  return exit ? `${prompt.trim().replace(/[。.]?$/, '。')}镜头结束时的画面：${exit}。` : prompt
}
