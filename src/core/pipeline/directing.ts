import { db } from '@/core/storage/db'
import { productionJson, type Production, type SceneSpec } from './production'
import type { StoryboardDraft } from '@/core/prompts/storyboard'
import { createCharacter } from '@/core/storage/characters'
import { appendStoryboardFromDraft } from '@/core/storage/storyboards'
import { parseShots } from './storyboard'
import {
  DIRECTOR_RULES,
  NOVELIST_RULES,
  ONE_LINE_STORY_RULES,
  SHORT_VIDEO_RULES,
  WRITER_ACTION_GUIDANCE,
} from '@/core/prompts/production-skills'
import type { Chapter, DramaPlan } from './chapters'
import type { Character, Project, Provider } from '@/types/domain'
import type { ProductionPreset } from './presets'
import { videoDurations, pickVoices } from './presets'
import { fitShotTiming, normalizeBeatSeconds } from './timing'

export async function sourceHash(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
export function beatRange(durationSec: number): [number, number] {
  return durationSec <= 20 ? [2, 4] : durationSec <= 30 ? [3, 6] : durationSec <= 90 ? [4, 8] : [5, 10]
}
/** 一句话创意的目标字数：够覆盖成片时长，又不至于让改编大量删减。 */
export function storyWordsFor(durationSec: number): number {
  return durationSec <= 30 ? 600 : durationSec <= 60 ? 1000 : 1400
}
export async function writeNovel(
  provider: Provider,
  idea: string,
  signal: AbortSignal,
  mode: 'novel' | 'oneLine' = 'novel',
) {
  const raw = (await productionJson(
    provider,
    (mode === 'oneLine' ? ONE_LINE_STORY_RULES : NOVELIST_RULES) +
      '\n动作与细节修订准则：\n' +
      WRITER_ACTION_GUIDANCE,
    idea,
    undefined,
    signal,
  )) as { title: string; text: string; revisionNotes: string[] }
  if (
    !raw ||
    typeof raw.title !== 'string' ||
    typeof raw.text !== 'string' ||
    raw.text.trim().length < 300 ||
    raw.text.length > 30000 ||
    !Array.isArray(raw.revisionNotes)
  )
    throw new Error('小说正文不完整：需要 300–30,000 字完整正文及修订记录。')
  const text = raw.text.trim()
  return {
    title: raw.title.trim(),
    text,
    revisionNotes: raw.revisionNotes.filter((s) => typeof s === 'string'),
    hash: await sourceHash(text),
  }
}
export async function directCharacters(
  provider: Provider,
  projectId: string,
  chapter: Chapter,
  signal: AbortSignal,
  allowEmpty = false,
) {
  const raw = (await productionJson(
    provider,
    `你是选角导演。提取实际出场角色，不增加不存在的人。为每人写一段可直接用于画图的定妆设定：年龄感、脸型五官、发型发色、身材、本场服装（颜色材质款式）、鞋、饰物与随身道具，以及性格目标和人物关系；原文缺少的外貌按人物身份合理补全并保持克制。返回 {"characters":[{"name":"姓名","role":"protagonist或supporting或extra","gender":"male或female","age":"child/young/adult/elder","voice_style":"声音气质，如清亮少年音、低沉沙哑","description":"具体可执行设定"}]}，${allowEmpty ? '0' : '1'}–8人。`,
    chapter.text,
    undefined,
    signal,
  )) as { characters: Pick<Character, 'name' | 'role' | 'description'>[] }
  if (
    !Array.isArray(raw?.characters) ||
    (!allowEmpty && !raw.characters.length) ||
    raw.characters.length > 8 ||
    raw.characters.some(
      (c) =>
        !c ||
        typeof c.name !== 'string' ||
        !c.name.trim() ||
        typeof c.description !== 'string' ||
        !['protagonist', 'supporting', 'extra'].includes(c.role),
    )
  )
    throw new Error('角色卡返回格式错误，请重试当前节点。')
  await db.transaction('rw', db.characters, async () => {
    const existing = await db.characters.where('projectId').equals(projectId).toArray()
    for (const c of raw.characters)
      if (!existing.some((e) => e.name === c.name)) {
        const extra = c as { gender?: unknown; age?: unknown }
        const created = await createCharacter({
          projectId,
          name: c.name,
          role: c.role,
          description: c.description,
          gender: extra.gender === 'male' ? 'male' : extra.gender === 'female' ? 'female' : undefined,
          age: ['child', 'young', 'adult', 'elder'].includes(String(extra.age)) ? String(extra.age) : undefined,
        })
        existing.push(created)
      }
    // Distinct default voices per character; the user can change them on the cast strip.
    const voices = pickVoices(existing)
    for (const c of existing) if (!c.voice && voices[c.id]) await db.characters.update(c.id, { voice: voices[c.id] })
  })
}
export async function directPlan(
  provider: Provider,
  chapter: Chapter,
  project: Project,
  characters: Character[],
  preset: ProductionPreset,
  signal: AbortSignal,
): Promise<DramaPlan> {
  const [minBeats, maxBeats] = beatRange(preset.durationSec)
  const formatRule =
    preset.format === 'scene'
      ? `这是一条${preset.durationSec}秒的单场景短片：只在一个连续的场景里发生，时间连续不跳跃，情绪或动作有完整的起势、变化和落点，结尾有余韵或一个小反转。`
      : ''
  const p = (await productionJson(
    provider,
    `${DIRECTOR_RULES}${formatRule} 将本章精编为${preset.durationSec}秒短剧，保留因果和关键选择，明确开场钩子、冲突、升级、反转和结尾。${SHORT_VIDEO_RULES}输出 {"logline":"一句话","hook":"钩子","ending":"结尾","title":"片头大标题，8–14字，制造悬念或冲突，不剧透结局","publish":{"title":"发布标题，20字内，口语化有悬念","description":"发布简介，60字内","hashtags":["3–5个话题，不带#号"]},"beats":[{"title":"节拍","description":"动作、对白、原文对应与压缩取舍","durationSec":整数秒}]}，${minBeats}–${maxBeats}个节拍，时长合计${preset.durationSec}秒。输出语言${preset.language}。`,
    JSON.stringify({ chapter, project, characters }),
    undefined,
    signal,
  )) as DramaPlan
  if (
    !p ||
    typeof p.logline !== 'string' ||
    typeof p.hook !== 'string' ||
    typeof p.ending !== 'string' ||
    !Array.isArray(p.beats) ||
    p.beats.length < minBeats ||
    p.beats.length > maxBeats ||
    p.beats.some((b) => !b || typeof b.description !== 'string' || typeof b.title !== 'string')
  )
    throw new Error(`方案必须有${minBeats}–${maxBeats}个完整节拍。`)
  // Models often miss the exact sum by a few seconds; rescale instead of failing the paid request.
  const fitted = normalizeBeatSeconds(
    p.beats.map((b) => Number(b.durationSec)),
    preset.durationSec,
  )
  p.beats = p.beats.map((b, i) => ({ ...b, durationSec: fitted[i] }))
  // Title and publishing copy are optional quality extras; never fail a paid plan on them.
  const title = typeof p.title === 'string' ? p.title.trim().slice(0, 18) : ''
  const publish =
    p.publish && typeof p.publish === 'object' && typeof p.publish.title === 'string'
      ? {
          title: p.publish.title.trim().slice(0, 40),
          description: typeof p.publish.description === 'string' ? p.publish.description.trim().slice(0, 200) : '',
          hashtags: Array.isArray(p.publish.hashtags)
            ? p.publish.hashtags.filter((t): t is string => typeof t === 'string').map((t) => t.replace(/^#+/, '').trim()).filter(Boolean).slice(0, 6)
            : [],
        }
      : undefined
  return { ...p, title: title || undefined, publish }
}
export interface RepairHint {
  previous: unknown
  issues: string[]
}
export class ShotPlanError extends Error {
  readonly repair: RepairHint
  constructor(message: string, repair: RepairHint) {
    super(message)
    this.repair = repair
  }
}
export async function directShots(
  provider: Provider,
  video: Provider,
  prod: Production,
  project: Project,
  characters: Character[],
  preset: ProductionPreset,
  signal: AbortSignal,
  repair?: RepairHint,
) {
  const durations = videoDurations(video),
    maxSec = Math.max(...durations),
    perShot = preset.budget === 'economy' ? 5 : preset.budget === 'balanced' ? 4 : 3,
    minShots = Math.ceil(preset.durationSec / maxSec),
    maxShots = Math.max(minShots, Math.ceil(preset.durationSec / perShot) + 2),
    suggested = Math.round(preset.durationSec / perShot)
  const lineCap = Math.floor((maxSec - 0.3) * 4)
  const narrationRule =
    preset.audio === 'dialogue'
      ? `声音采用“角色对白分角色配音”，像真人短剧一样让人物自己说话，不用解说腔旁白。每镜最多一句台词：speaker填说话的登记角色姓名；确需交代心理时用speaker="内心"写说话角色的第一人称内心独白（全片不超过2句）；只有片头钩子或时间跳跃才允许speaker="旁白"（全片最多1句）；无台词的镜头narration为空串。台词口语化、有潜台词，像人话，单句不超过${lineCap}字，全片台词合计不超过${Math.floor(preset.durationSec * 3)}字；delivery写表演指示（情绪、语气、音量、语速，如“压着火气，一字一顿”）。对白场面用正反打：说话人正脸中近景时，video_prompt写“X开口说话，口型自然，表情…”；较长台词优先放在过肩镜头或听者的反应镜头上（声音先行/滞后的L-cut）。视频画面本身不要生成人声对白，只保留环境声。`
      : preset.audio === 'narration'
        ? `所有narration作为后期单人旁白（解说式讲故事），speaker填"旁白"，第一镜旁白就是钩子，之后每镜一句推进剧情的旁白（纯反应/空镜可为空串）。旁白按每秒4个汉字估算，全片旁白合计不超过${Math.floor(preset.durationSec * 3.2)}字，单镜不超过${lineCap}字。画面不安排口型对白，视频Prompt要求无人声、人物不张嘴说话。`
        : `保留模型原声，不假设模型一定生成人声；字幕文字按每秒4个汉字估算，单镜不超过${lineCap}字。`
  const sceneRule =
    preset.format === 'scene'
      ? `这是单场景短片：scenes只有一个S1，全部镜头在同一场景、同一段连续时间内。共${minShots}–${Math.max(minShots, Math.min(maxShots, 5))}镜，优先用continuous把动作串成一气呵成的连续镜头，最多安排一到两次cut（如切到特写或反应）。`
      : `先拆场次再拆镜头：同一地点同一时间为一个场次，场次数量尽量少（${preset.durationSec <= 30 ? '1–2' : preset.durationSec <= 60 ? '2–4' : '3–6'}个）。每个场次用“建立镜（远景/全景交代空间）→中景推进→近景/特写抓情绪与关键道具→反应镜”的覆盖逻辑。`
  const instruction = `${DIRECTOR_RULES}
${sceneRule}
衔接规则（专业剪辑）：continuity只有两种——"continuous"表示同一机位、同一景别继续拍摄上一镜动作的下一阶段（程序会直接用上一镜的最后一帧作为本镜首帧，实现无缝衔接，所以本镜image_prompt要与上一镜结束画面一致，video_prompt只写接下来的动作），只能用在同一场次、上一镜动作尚未完成时；"cut"表示换机位或景别直接切（动作匹配剪辑、正反打、插入特写），每场第一镜和跨场次必须是cut。cut时遵守180度轴线：人物在屏幕上的左右位置、视线方向和运动方向与上一镜保持一致；相邻两个cut的景别要有明显变化，避免同景别跳切。每个video_prompt只描述5秒内能完成的一个动作和一种运镜，写明起止状态，动作幅度小而清楚，避免转身大动作、多人复杂交互、快速运镜。
输出 {"scenes":[{"id":"S1","name":"场次名","setting":"地点、陈设、时代、时间与天气（只写环境，不写人物）","lighting":"主光方向、色温与影调","blocking":"人物在画面中的站位和左右关系"}],"shots":[{"sequence":1,"scene_id":"S1","shot_size":"establishing/wide/medium/close/extreme-close/insert","continuity":"cut或continuous","scene_text":"可见画面与动作","speaker":"说话人：登记角色姓名/内心/旁白，无台词为空串","narration":"本镜台词，无则空串","delivery":"台词表演指示","image_prompt":"独立静态首帧Prompt：景别机位、人物位置姿态、场景、光线，不含时间序列","video_prompt":"从首帧出发的动作、表情、单一运镜、终点","character_names":["登记姓名"],"duration_sec":建议成片镜长秒数,"direction":{"scene":"场次/地点/时间","purpose":"叙事作用","framing":"景别机位构图","eyeline":"屏幕左右与视线方向","sound":"声音设计","sourceExcerpt":"本镜依据的原文短句"},"edit":{"entryState":"起始人物动作道具状态","exitState":"结束状态","cutNote":"切到下镜的具体动作或反应接点"}}]}。
共约${preset.format === 'scene' ? Math.max(minShots, 3) : suggested}镜（${minShots}–${maxShots}镜）。duration_sec只表达节奏：快切反应镜1.5–3秒，信息与情绪镜3–${maxSec}秒，单镜不超过${maxSec}秒；不用凑总数，程序会按比例精确配平到${preset.durationSec}秒。只引用登记角色；character_names必须列出本镜画面中出现的每一个登记角色（程序会用他们的定妆照和场次定场图保持长相、服装和环境一致），image_prompt里用角色姓名指代人物并写清各自位置动作，不必重复描写外貌和环境细节。${narrationRule}画幅${preset.aspectRatio}，风格${preset.style}，输出语言${preset.language}。画面下方约20%区域会叠加字幕，首帧构图让人物面部位于画面中上部，不要在画面中生成任何文字、字幕或水印。`
  const evaluate = (raw: unknown) => {
    const shots = parseShots(JSON.stringify(raw ?? {}))
    const names = new Set(characters.map((c) => c.name))
    const issues: string[] = []
    if (shots.length < minShots || shots.length > maxShots)
      issues.push(`分镜数量${shots.length}，需要${minShots}–${maxShots}镜`)
    for (const [index, s] of shots.entries()) {
      // Cosmetic fields are filled in rather than failing a paid request.
      if (!s.video_prompt?.trim()) s.video_prompt = s.scene_text
      if (!s.image_prompt?.trim()) issues.push(`镜头${index + 1}：静态首帧Prompt缺失`)
      s.character_names = (s.character_names ?? []).filter((n) => names.has(n))
      if (!s.narration?.trim()) s.speaker = undefined
      else if (!s.speaker || !(names.has(s.speaker) || ['内心', '旁白'].includes(s.speaker)))
        s.speaker = preset.audio === 'dialogue' && s.character_names.length === 1 ? s.character_names[0] : '旁白'
      const d = (s.direction ?? {}) as Partial<NonNullable<typeof s.direction>>
      s.direction = {
        scene: String(d.scene ?? ''),
        purpose: String(d.purpose ?? ''),
        framing: String(d.framing ?? ''),
        eyeline: String(d.eyeline ?? ''),
        sound: String(d.sound ?? ''),
        sourceExcerpt: String(d.sourceExcerpt ?? ''),
      }
    }
    normalizeContinuity(shots)
    const timing = shots.length
      ? fitShotTiming(
          shots.map((s, i) => ({
            desiredSec: s.duration_sec,
            narration: s.narration,
            exact: s.continuity === 'continuous' && shots[i + 1]?.continuity === 'continuous',
          })),
          preset.durationSec,
          durations,
        )
      : undefined
    if (timing && !timing.ok) issues.push(...timing.issues)
    return { shots, issues, timing }
  }
  // Earlier drafts that only failed on timing now fit locally: reuse them without a new paid request.
  let raw: unknown = repair?.previous
  let { shots, issues, timing } = evaluate(raw)
  if (!repair || issues.length || !timing?.ok) {
    const previousIssues = issues.length ? issues : (repair?.issues ?? [])
    raw = await productionJson(
      provider,
      repair
        ? `${instruction}\n上一版分镜未通过程序校验：${previousIssues.join('；')}。请在上一版基础上做最小修改解决这些问题，保留其余镜头内容，输出完整JSON。`
        : instruction,
      JSON.stringify({
        chapter: prod.chapters.find((c) => c.id === prod.selectedId),
        plan: prod.plan,
        characters,
        ...(repair ? { previousShots: repair.previous } : {}),
      }),
      undefined,
      signal,
    )
    ;({ shots, issues, timing } = evaluate(raw))
  }
  if (issues.length || !timing?.ok) {
    await db.generations.put({
      id: crypto.randomUUID(),
      projectId: project.id,
      stageName: 'storyboard',
      status: 'failed',
      input: { preset },
      output: raw,
      error: issues.join('；'),
      retry: repair ? 1 : 0,
      createdAt: Date.now(),
    })
    throw new ShotPlanError('分镜未通过校验：' + issues.join('；'), { previous: raw, issues })
  }
  if (!timing?.ok) throw new Error('unreachable')
  shots.forEach((s, i) => {
    const t = timing.shots[i]
    s.duration_sec = t.materialSec
    const out = t.trimOutSec
    // Trim window inside the generated clip:
    //  - followed by a continuous shot → end on the clip's last frame (the next shot starts from it)
    //  - continuous itself → start at frame 0 (it already starts where the previous shot ended)
    //  - otherwise skip the first ~0.25s where AI clips often sit still
    const nextContinuous = shots[i + 1]?.continuity === 'continuous'
    const trimIn = nextContinuous
      ? Math.max(0, t.materialSec - out)
      : s.continuity === 'continuous'
        ? 0
        : Math.min(0.24, Math.max(0, t.materialSec - out))
    s.edit = {
      trimInSec: Math.round(trimIn * 25) / 25,
      trimOutSec: Math.round((trimIn + out) * 25) / 25,
      entryState: s.edit?.entryState || '承接上一镜',
      exitState: s.edit?.exitState || '动作完成',
      cutNote: s.edit?.cutNote || '动作完成处直接切',
    }
  })
  await db.transaction('rw', [db.storyboards, db.productions], async () => {
    if (await db.storyboards.where('projectId').equals(project.id).count())
      throw new Error('已有分镜，请在专业模式修改具体镜头；不会覆盖已有素材。')
    for (const [i, s] of shots.entries())
      await appendStoryboardFromDraft(project.id, { ...s, sequence: i + 1 }, characters)
    await db.productions.update(project.id, { promptsReady: true, scenes: readScenes(raw, shots) })
  })
}

/** 第一镜、跨场次一律视为 cut；continuous 只在同一场次内成立。 */
export function normalizeContinuity(shots: StoryboardDraft[]) {
  const ids = new Map<string, string>()
  shots.forEach((s, i) => {
    // Fall back to the free-text scene label when the model omitted scene ids.
    if (!s.scene_id) {
      const key = (s.direction?.scene || 'S1').trim()
      if (!ids.has(key)) ids.set(key, `S${ids.size + 1}`)
      s.scene_id = ids.get(key)
    }
    const prev = shots[i - 1]
    if (!prev || prev.scene_id !== s.scene_id) s.continuity = 'cut'
    else s.continuity = s.continuity === 'continuous' ? 'continuous' : 'cut'
  })
}
export function readScenes(raw: unknown, shots: StoryboardDraft[]): SceneSpec[] {
  const list = Array.isArray((raw as { scenes?: unknown })?.scenes)
    ? ((raw as { scenes: unknown[] }).scenes as Record<string, unknown>[])
    : []
  const used = [...new Set(shots.map((s) => s.scene_id).filter((x): x is string => !!x))]
  return used.map((id) => {
    const found = list.find((x) => x && String(x.id) === id) ?? {}
    const sample = shots.find((s) => s.scene_id === id)
    return {
      id,
      name: String(found.name ?? sample?.direction?.scene ?? id),
      setting: String(found.setting ?? sample?.direction?.scene ?? ''),
      lighting: String(found.lighting ?? ''),
      blocking: found.blocking ? String(found.blocking) : undefined,
    }
  })
}
