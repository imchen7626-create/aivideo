import { db, flushLocalStore } from '@/core/storage/db'
import { splitChapters } from './chapters'
import {
  directCharacters,
  directPlan,
  directShots,
  sourceHash,
  ShotPlanError,
  type RepairHint,
} from './directing'
import { collectReferenceImages, generateShotImage } from './image-shot'
import { generateShotVideo } from './video-shot'
import {
  castingOrder,
  appearanceAnchor,
  castingPrompt,
  generateWithReferences,
  referenceProvider,
  referenceSize,
  scenePlatePrompt,
  type ReferenceImage,
} from '@/core/image/reference'
import { withoutBlankBorders } from '@/core/image/borders'
import { extractLastFrame } from '@/core/composition/ffmpeg'
import { composeProject } from '@/core/composition/project'
import { buildEditTimeline, getEditedDuration } from '@/core/composition/plan'
import { buildProductionPackage } from '@/core/export/production'
import { createAsset } from '@/core/storage/assets'
import { generateTtsAudio } from '@/core/composition/tts'
import {
  applyModelSettings,
  defaultPreset,
  normalizePreset,
  preflight,
  resolveAudio,
  usesVoice,
  lipSyncProvider,
  NARRATOR_VOICE,
} from './presets'
import { uploadToDashScope } from '@/core/bailian-upload'
import { formatFromRejection, resolutionFromRejection } from '@/core/video/aliyun-client'
import { firstFramePrompt, inBed, showsNoCharacters } from './continuity'
import { revealsNewSpace } from './request-hints'
import { lipSyncMinAudioSec, padWavToMinDuration, wavDurationSec } from '@/core/composition/wav'
import { MAX_VOICE_TEMPO } from '@/core/composition/concat'
import type { Provider, ProviderKind } from '@/types/domain'
import type { NodeId } from './production'

export type RunStage = NodeId | 'casting' | 'images' | 'voice' | 'package'
export interface AutomationRun {
  status: 'queued' | 'running' | 'paused' | 'cancelled' | 'failed' | 'done'
  stage: RunStage
  detail: string
  updatedAt: number
  completed: number
  total: number
  submissions: number
  operations: Record<string, { status: 'started' | 'done' | 'failed'; at: number }>
  error?: string
}
export const stageLabels: Record<RunStage, string> = {
  upload: '上传脚本',
  parse: '解析章节',
  characters: '角色卡',
  plan: '剧情方案',
  prompts: '专业分镜',
  casting: '角色定妆',
  images: '生成首帧',
  video: '生成首帧与视频',
  voice: '后期旁白',
  compose: '剪辑合成',
  export: '导出',
  package: '整理成片包',
}
const controllers = new Map<string, AbortController>()
export function isPipelineActive(id: string) {
  return controllers.has(id)
}
export const newAutomation = (): AutomationRun => ({
  status: 'queued',
  stage: 'parse',
  detail: '已排队，准备自动制作',
  updatedAt: Date.now(),
  completed: 0,
  total: 0,
  submissions: 0,
  operations: {},
})
async function patchRun(id: string, patch: Partial<AutomationRun>) {
  await db.transaction('rw', db.productions, async () => {
    const p = await db.productions.get(id)
    if (p?.automation)
      await db.productions.update(id, {
        automation: { ...p.automation, ...patch, updatedAt: Date.now() },
      })
  })
  await flushLocalStore()
}
export async function stopPipeline(id: string, cancel = false) {
  controllers.get(id)?.abort()
  await patchRun(id, {
    status: cancel ? 'cancelled' : 'paused',
    detail: cancel
      ? '已取消后续执行；远端已提交任务仍保留，可继续查询'
      : '已暂停；已提交的远端视频任务仍保留',
  })
}
export async function queuePipeline(id: string, acknowledgeUncertain = false) {
  if (controllers.has(id)) throw new Error('任务正在结束当前操作，请稍后点击继续。')
  const p = await db.productions.get(id)
  if (!p?.automation) return
  const shots = await db.storyboards.where('projectId').equals(id).toArray()
  const operations = { ...p.automation.operations }
  for (const s of shots)
    if (s.pendingVideoTask && operations['video:' + s.id]?.status === 'started')
      operations['video:' + s.id] = { status: 'done', at: Date.now() }
  const uncertain = Object.entries(operations).filter(([, v]) => v.status === 'started')
  if (uncertain.length && !acknowledgeUncertain)
    throw new Error('存在提交后未确认结果的请求。请勾选确认后重试，服务商可能已计费。')
  for (const [k] of uncertain) operations[k] = { status: 'failed', at: Date.now() }
  await patchRun(id, {
    status: 'queued',
    operations,
    error: undefined,
    detail: '准备从未完成节点继续',
  })
}

/** 连续镜头（continuous）与上一镜同链，必须顺序生成；其余镜头各自成链。 */
export function buildChains<T extends { continuity?: string; sceneId?: string }>(shots: T[]): T[][] {
  const chains: T[][] = []
  for (const s of shots) {
    const last = chains[chains.length - 1]
    const prev = last?.[last.length - 1]
    if (last && s.continuity === 'continuous' && prev?.sceneId === s.sceneId) last.push(s)
    else chains.push([s])
  }
  return chains
}

/** Run tasks with bounded concurrency; waits for every worker before reporting the first error. */
export async function runPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (next < items.length) await fn(items[next++])
  })
  const results = await Promise.allSettled(workers)
  const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (rejected) throw rejected.reason
}

/** Durable single-project coordinator. A Web Lock prevents two tabs submitting the same task. */
export async function runPipeline(
  id: string,
  providers: Partial<Record<ProviderKind, Provider>>,
  models?: { tts?: string; reference?: string; lipSync?: string },
): Promise<void> {
  if (controllers.has(id)) return
  const controller = new AbortController()
  controllers.set(id, controller)
  try {
    if (navigator.locks)
      await navigator.locks.request(
        'studio-pipeline-' + id,
        { ifAvailable: true },
        async (lock) => {
          if (!lock) return
          await executePipeline(id, providers, controller.signal, models)
        },
      )
    else await executePipeline(id, providers, controller.signal, models)
  } finally {
    controllers.delete(id)
  }
}
async function executePipeline(
  id: string,
  providers: Partial<Record<ProviderKind, Provider>>,
  signal: AbortSignal,
  models?: { tts?: string; reference?: string; lipSync?: string },
) {
  const get = async () => {
    const row = await db.productions.get(id)
    if (!row) throw new Error('项目流水线记录缺失')
    return row
  }
  const check = () => signal.throwIfAborted()
  let stage: RunStage = 'parse'
  const setStage = async (s: RunStage, detail: string, completed = 0, total = 0) => {
    check()
    stage = s
    await patchRun(id, { status: 'running', stage: s, detail, completed, total })
  }
  // Reservation and completion are read-modify-write inside one transaction so that
  // concurrently running shots never lose a submission count or overwrite each other's state.
  const markOperation = async (
    key: string,
    status: 'started' | 'done' | 'failed',
    countSubmission = false,
    refund = false,
  ) => {
    await db.transaction('rw', db.productions, async () => {
      const row = await db.productions.get(id)
      const run = row?.automation
      if (!row || !run) throw new Error('项目流水线记录缺失')
      if (status === 'started') {
        if (run.operations[key]?.status === 'started')
          throw new Error('上次请求结果未确认，请确认可能重复计费后再继续。')
        if (countSubmission && run.submissions >= normalizePreset(row.preset).maxSubmissions)
          throw new Error('已达到本项目付费请求次数上限，请在制作预设提高上限后继续。')
      }
      await db.productions.update(id, {
        automation: {
          ...run,
          submissions: Math.max(0, run.submissions + (countSubmission ? 1 : 0) - (refund ? 1 : 0)),
          operations: { ...run.operations, [key]: { status, at: Date.now() } },
          updatedAt: Date.now(),
        },
      })
    })
    await flushLocalStore()
  }
  const operation = async (key: string, fn: () => Promise<void>, paid = true) => {
    check()
    if (paid) await markOperation(key, 'started', true)
    else if ((await get()).automation!.operations[key]?.status === 'started')
      throw new Error('上次请求结果未确认，请确认可能重复计费后再继续。')
    try {
      await fn()
      if (paid) await markOperation(key, 'done')
    } catch (error) {
      if (
        paid &&
        !signal.aborted &&
        !/fetch|network|timeout|timed out|网络|超时|连接中断|可能已|响应里没找到|任务 id/i.test(
          String(error),
        )
      )
        // Requests the provider rejected outright (4xx) were not billed: give the count back.
        await markOperation(key, 'failed', false, /HTTP (400|401|403|404|429)/.test(String(error)))
      throw error
    }
  }
  // One repair attempt. Structured validation failures carry the previous output and the
  // concrete issues so the model edits its draft instead of starting over blind.
  const modelStep = async (key: string, fn: (repair?: RepairHint) => Promise<void>) => {
    try {
      await operation(key, () => fn())
    } catch (error) {
      const run = (await get()).automation!
      if (
        signal.aborted ||
        run.operations[key]?.status !== 'failed' ||
        !(error instanceof ShotPlanError || /JSON|格式|分镜|方案必须|对白|原文定位/.test(String(error)))
      )
        throw error
      await patchRun(id, {
        detail: `模型输出未通过校验，正在按具体问题修正本节点（1/1）；仍受请求上限约束`,
      })
      await operation(key, () => fn(error instanceof ShotPlanError ? error.repair : undefined))
    }
  }
  try {
    let prod = await get()
    const preset = resolveAudio(applyModelSettings(normalizePreset(prod.preset ?? defaultPreset), models), providers),
      issues = preflight(preset, providers)
    if (prod.preset?.audio !== preset.audio || prod.preset?.voice !== preset.voice)
      await db.productions.update(id, { preset })
    if (issues.length) throw new Error(issues.join('；'))
    const project = await db.projects.get(id)
    if (!project) throw new Error('项目不存在')
    if (!prod.chapters.length) {
      await setStage('parse', '正在识别章节标题')
      const materials = await db.materials.where('projectId').equals(id).toArray()
      const text = materials.map((m) => m.text).join('\n'),
        chapters = splitChapters(text)
      if (!chapters.length) throw new Error('原文为空')
      await db.productions.update(id, {
        chapters,
        selectedId: chapters[0].id,
        sourceHash: await sourceHash(text),
      })
    }
    prod = await get()
    const chapter = prod.chapters.find((c) => c.id === prod.selectedId)
    if (!chapter) throw new Error('请选择要制作的章节')
    const hash = await sourceHash(chapter.text)
    if (prod.sourceHash && prod.sourceHash !== hash && prod.plan)
      throw new Error('小说版本已变化，请先保存新版本并更新改编方案。')
    await db.productions.update(id, { sourceHash: hash })
    if (
      !(await db.characters.where('projectId').equals(id).count()) &&
      (await get()).automation?.operations.characters?.status !== 'done'
    ) {
      await setStage('characters', '提取人物动机、关系和一致性视觉设定')
      await modelStep('characters', () =>
        directCharacters(providers.llm!, id, chapter, signal, preset.format === 'scene'),
      )
    }
    const characters = await db.characters.where('projectId').equals(id).toArray()
    prod = await get()
    if (!prod.plan) {
      await setStage('plan', '编剧正在提炼冲突、转折和情感落点')
      await modelStep('plan', async () => {
        const plan = await directPlan(providers.llm!, chapter, project, characters, preset, signal)
        await db.productions.update(id, { plan })
      })
    }
    prod = await get()
    if (!prod.promptsReady) {
      await setStage('prompts', '分镜师与剪辑师正在设计镜头、动作接点和声音')
      // Resuming after a failed storyboard: repair the last draft instead of paying for a blind rewrite.
      const lastFailed = (
        await db.generations.where('projectId').equals(id).toArray()
      )
        .filter((g) => g.stageName === 'storyboard' && g.status === 'failed' && g.output)
        .sort((a, b) => b.createdAt - a.createdAt)[0]
      const resumeHint: RepairHint | undefined = lastFailed
        ? { previous: lastFailed.output, issues: String(lastFailed.error ?? '').split('；').filter(Boolean) }
        : undefined
      await modelStep('prompts', (repair) =>
        directShots(
          providers.llm!,
          providers.image2video!,
          prod,
          project,
          characters,
          preset,
          signal,
          repair ?? resumeHint,
        ),
      )
    }
    // Frames, end frames and plates: an occasional blank edge band (white strip) is cropped away.
    const drawFrame = async (...args: Parameters<typeof generateWithReferences>) =>
      withoutBlankBorders(await generateWithReferences(...args))
    // Character consistency: one costume reference per main character before any shot is drawn.
    const refModel =
      preset.consistency && providers.text2image
        ? referenceProvider(providers.text2image, preset.referenceModel)
        : undefined
    if (refModel) {
      const planned = await db.storyboards.where('projectId').equals(id).toArray()
      const appearances = new Map<string, number>()
      for (const s of planned)
        for (const c of s.characterIds) appearances.set(c, (appearances.get(c) ?? 0) + 1)
      const castList = castingOrder(await db.characters.where('projectId').equals(id).toArray(), appearances)
      for (const [index, c] of castList.entries()) {
        check()
        if (c.referenceAssetId && (await db.assets.get(c.referenceAssetId))) continue
        await setStage('casting', `为「${c.name}」生成定妆照，后续每镜按定妆照出图`, index, castList.length)
        await operation('cast:' + c.id, async () => {
          const blob = await generateWithReferences(refModel, {
            prompt: castingPrompt(c, preset.style),
            references: [],
            size: referenceSize('9:16'),
            signal,
          })
          const asset = await createAsset({ projectId: id, kind: 'image', mimeType: blob.type || 'image/png', blob })
          await db.characters.update(c.id, { referenceAssetId: asset.id, locked: true })
        })
      }
    }
    // Scene consistency: one empty establishing plate per scene, used as the environment reference.
    if (refModel) {
      const scenes = (await get()).scenes ?? []
      for (const [index, sc] of scenes.entries()) {
        check()
        const existing = (await get()).sceneRefs?.[sc.id]
        if (existing && (await db.assets.get(existing))) continue
        await setStage('casting', `为场次「${sc.name}」生成定场图，统一环境、光线与色调`, index, scenes.length)
        await operation('scene:' + sc.id, async () => {
          const blob = await drawFrame(refModel, {
            prompt: scenePlatePrompt(sc, preset.style),
            references: [],
            size: referenceSize(preset.aspectRatio, preset.resolution),
            signal,
          })
          const asset = await createAsset({ projectId: id, kind: 'image', mimeType: blob.type || 'image/png', blob })
          await db.transaction('rw', db.productions, async () => {
            const row = await db.productions.get(id)
            await db.productions.update(id, { sceneRefs: { ...(row?.sceneRefs ?? {}), [sc.id]: asset.id } })
          })
        })
      }
    }
    /**
     * 每镜参考图，合计不超过 3 张：出镜角色定妆照（另有参考时最多 2 人）+ 同场上一镜首帧
     * （光线、站位与道具状态的连续性），还有空位时再加场次定场图。
     */
    const castReferences = async (characterIds: string[], sceneId?: string, previousFrame?: ReferenceImage) => {
      const out: ReferenceImage[] = []
      const plateId = sceneId ? (await get()).sceneRefs?.[sceneId] : undefined
      const plate = plateId ? await db.assets.get(plateId) : undefined
      const limit = plate || previousFrame ? 2 : 3
      for (const cid of characterIds) {
        const c = await db.characters.get(cid)
        const a = c?.referenceAssetId ? await db.assets.get(c.referenceAssetId) : undefined
        if (c && a && out.length < limit)
          out.push({ name: c.name, blob: a.blob, kind: 'character', label: `角色「${c.name}」的外观参考图` })
      }
      if (previousFrame) out.push(previousFrame)
      if (plate && out.length < 3) {
        const sc = (await get()).scenes?.find((x) => x.id === sceneId)
        out.push({ name: sc?.name ?? '场景', blob: plate.blob, kind: 'scene', label: `场景「${sc?.name ?? sceneId}」的定场图` })
      }
      return out
    }
    const lipModel =
      preset.lipSync && preset.audio === 'dialogue' && providers.tts
        ? lipSyncProvider(providers.image2video, preset.lipSyncModel)
        : undefined
    const lipSyncNotes: string[] = []
    let lipBroken = false
    const failures: string[] = []
    let shots = await db.storyboards.where('projectId').equals(id).sortBy('sequence')
    const total = shots.length
    // A cut inside a scene draws its first frame after the previous shot's, using it as a reference.
    // Only the first frame waits; videos still render in parallel.
    const planned = shots
    const imageSettled = new Map<string, () => void>()
    const imageReady = new Map(
      planned.map((s) => [s.id, new Promise<void>((resolve) => imageSettled.set(s.id, resolve))]),
    )
    const previousFrameFor = async (shot: (typeof planned)[number]): Promise<ReferenceImage | undefined> => {
      // The most recent earlier shot at the same place: returning to a room after another place
      // keeps the room and where everyone was.
      const index = planned.findIndex((s) => s.id === shot.id)
      // A prop close-up in between says nothing about where people are, so it is skipped.
      const prev = shot.sceneId
        ? planned.slice(0, Math.max(0, index)).reverse().find((s) => s.sceneId === shot.sceneId && s.characterIds.length > 0)
        : undefined
      if (!prev) return undefined
      await imageReady.get(prev.id)
      check()
      const saved = await db.storyboards.get(prev.id)
      const frame = saved?.imageAssetId ? await db.assets.get(saved.imageAssetId) : undefined
      return frame
        ? { name: `镜头${prev.sequence}`, blob: frame.blob, kind: 'previous', label: `上一镜（镜头${prev.sequence}）的首帧画面` }
        : undefined
    }
    let imagesDone = 0,
      videosDone = 0,
      voicesDone = 0
    const voiceTotal =
      usesVoice(preset) ? shots.filter((s) => s.narration?.trim()).length : 0
    const report = async (detail: string) => {
      check()
      const s: RunStage = imagesDone < total ? 'images' : videosDone < total ? 'video' : 'voice'
      stage = s
      await patchRun(id, {
        status: 'running',
        stage: s,
        detail: `首帧 ${imagesDone}/${total} · 视频 ${videosDone}/${total}${voiceTotal ? ` · 旁白 ${voicesDone}/${voiceTotal}` : ''} · ${detail}`,
        completed: videosDone,
        total,
      })
    }
    const imageSize = (image: Provider) =>
      /workspace\.aliyun|maas\.aliyuncs/.test(image.baseUrl)
        ? preset.aspectRatio === '9:16'
          ? '928x1664'
          : '1664x928'
        : preset.aspectRatio === '9:16'
          ? '1024x1792'
          : '1792x1024'
    const shotTask = async (shot: (typeof shots)[number], previous?: (typeof shots)[number]) => {
      check()
      let current = (await db.storyboards.get(shot.id)) ?? shot
      // Continuous shot: start exactly where the previous clip ended (free, and seamless).
      if (
        current.continuity === 'continuous' &&
        previous &&
        !(current.imageAssetId && (await db.assets.get(current.imageAssetId)))
      ) {
        const prev = await db.storyboards.get(previous.id)
        const clip = prev?.videoAssetId ? await db.assets.get(prev.videoAssetId) : undefined
        if (clip)
          try {
            await report(`镜头 ${shot.sequence}：取上一镜尾帧作为首帧，连续衔接`)
            const frame = await extractLastFrame(clip.blob)
            const asset = await createAsset({ projectId: id, kind: 'image', mimeType: 'image/png', blob: frame })
            await db.storyboards.update(shot.id, { imageAssetId: asset.id, status: 'image-ready' })
            current = (await db.storyboards.get(shot.id)) ?? current
          } catch {
            /* fall back to drawing the frame from references */
          }
      }
      if (!(current.imageAssetId && (await db.assets.get(current.imageAssetId)))) {
        await report(`镜头 ${shot.sequence}：生成静态首帧`)
        try {
          await operation('image:' + shot.id, async () => {
            const image = providers.text2image!
            // References paint people into the frame. Nobody on screen (empty shot): no character
            // references. A point-of-view shot (its viewer was already dropped from the cast while
            // directing): no previous frame either, since that frame shows the viewer.
            const nobody = showsNoCharacters(current.imagePrompt)
            const pov = /的主观视角：/.test(current.imagePrompt ?? '')
            const visible = nobody ? [] : shot.characterIds
            // A close-up or insert shows a hand or a shoulder: given a full-body costume photo the
            // model draws the whole person (a second copy of her by the bed, or pulls back to a
            // medium shot and moves the prop). Their look is kept by the appearance text instead.
            const closeUp = ['insert', 'extreme-close'].includes(current.shotSize ?? '')
            const cast = refModel
              ? await castReferences(
                  closeUp ? [] : visible,
                  shot.sceneId,
                  // A prop close-up (no one on screen) would copy the previous wide framing
                  // instead of moving in; it keeps the room through the scene plate alone.
                  nobody || pov || closeUp || !visible.length ? undefined : await previousFrameFor(shot),
                )
              : []
            // The same hair, clothes and accessories in every shot, stated in words as well.
            const onScreen = (await db.characters.bulkGet(visible)).filter((c): c is NonNullable<typeof c> => !!c)
            const framePrompt =
              appearanceAnchor(onScreen, inBed(current.edit?.entryState, onScreen.map((c) => c.name))) +
              (current.imagePrompt?.trim() || current.sceneText)
            if (refModel && cast.length) {
              // Character consistency: render the frame from the approved costume references.
              const blob = await drawFrame(refModel, {
                prompt: firstFramePrompt(framePrompt, current.edit?.entryState),
                references: cast,
                size: referenceSize(preset.aspectRatio, preset.resolution),
                signal,
              })
              const asset = await createAsset({
                projectId: id,
                kind: 'image',
                mimeType: blob.type || 'image/png',
                blob,
              })
              await db.storyboards.update(shot.id, { imageAssetId: asset.id, status: 'image-ready' })
              return
            }
            const supportsReferences =
              image.apiFlavor === 'gemini' || /seedream|qwen-image-edit/i.test(image.model)
            const references = supportsReferences
              ? await collectReferenceImages(id, visible)
              : []
            for await (const e of generateShotImage({
              provider: image,
              storyboard: { ...current, imagePrompt: framePrompt },
              referenceImageBlobs: references,
              size: imageSize(image),
              signal,
            })) {
              if (e.phase === 'error') throw new Error(e.message || '首帧生成失败')
            }
          })
        } catch (e) {
          if (signal.aborted) throw e
          failures.push(`镜头 ${shot.sequence} 首帧：${String(e)}`)
          return
        }
        current = (await db.storyboards.get(shot.id)) ?? current
        if (!current.imageAssetId) {
          failures.push(`镜头 ${shot.sequence} 首帧：没有保存图片`)
          return
        }
      }
      imageSettled.get(shot.id)?.()
      imagesDone++
      if (current.videoAssetId && (await db.assets.get(current.videoAssetId))) {
        videosDone++
        await report(`镜头 ${shot.sequence} 已有视频`)
        return
      }
      await report(
        `镜头 ${shot.sequence}：${current.pendingVideoTask ? '继续查询原视频任务' : '提交视频生成'}`,
      )
      // Lip sync: a line spoken by a character who is on screen drives the video model with the voice.
      let videoProvider = providers.image2video!
      let audioUrl: string | undefined
      const speakerOnScreen =
        !!lipModel &&
        !lipBroken &&
        !!current.narration?.trim() &&
        !!current.speaker &&
        (await db.characters.where('id').anyOf(current.characterIds).toArray()).some(
          (c) => c.name === current.speaker,
        )
      if (lipModel && current.pendingVideoTask?.model === lipModel.model) videoProvider = lipModel
      else if (speakerOnScreen && !current.pendingVideoTask && lipModel)
        try {
          const voiceBlob = await ensureVoice(current)
          if (voiceBlob) {
            await report(`镜头 ${shot.sequence}：上传配音，生成口型同步视频`)
            // Lip-sync models reject driving audio shorter than 2–3s: pad short lines with trailing
            // silence (the mouth simply rests). The film keeps the original voice track.
            const padded = new Blob(
              [padWavToMinDuration(new Uint8Array(await voiceBlob.arrayBuffer()), lipSyncMinAudioSec(lipModel.model))],
              { type: voiceBlob.type || 'audio/wav' },
            )
            audioUrl = await uploadToDashScope(lipModel.apiKey, lipModel.model, padded, `shot-${shot.sequence}.wav`, signal)
            videoProvider = lipModel
          }
        } catch (e) {
          if (signal.aborted) throw e
          lipSyncNotes.push(`镜头 ${shot.sequence} 口型同步未启用（${String(e).slice(0, 80)}），按普通视频生成`)
        }
      // A pull-back reveals room the first frame never showed, and the video model invents it (a
      // second bed, a chandelier). Draw where the move ends from this first frame and the scene
      // plate, and hand it over as the last frame.
      if (
        refModel &&
        videoProvider === providers.image2video &&
        /^(?:wan3\.0-|wan2\.7-)/.test(videoProvider.model) &&
        revealsNewSpace(current.videoPrompt) &&
        !current.pendingVideoTask &&
        !(current.endImageAssetId && (await db.assets.get(current.endImageAssetId)))
      )
        try {
          await report(`镜头 ${shot.sequence}：生成运镜终点画面，锁定拉远后露出的房间`)
          await operation('endframe:' + shot.id, async () => {
            const first = await db.assets.get(current.imageAssetId!)
            const onScreen = (await db.characters.bulkGet(current.characterIds)).filter((c): c is NonNullable<typeof c> => !!c)
            const references = await castReferences(
              [],
              shot.sceneId,
              first ? { name: `镜头${shot.sequence}`, blob: first.blob, kind: 'previous', label: '本镜首帧画面' } : undefined,
            )
            const end = current.edit?.exitState || current.sceneText
            const blob = await drawFrame(refModel, {
              prompt: firstFramePrompt(
                appearanceAnchor(onScreen, inBed(end, onScreen.map((c) => c.name))) +
                  `本镜运镜结束时的画面：${end}。这是“${current.videoPrompt}”的终点，全景，取景接近场次定场图的视角，人物在画面中较小；房间就是定场图里的房间，只出现首帧和定场图里已有的家具陈设，人物的服装、位置与首帧一致。`,
                end,
              ),
              references,
              size: referenceSize(preset.aspectRatio, preset.resolution),
              signal,
            })
            const asset = await createAsset({ projectId: id, kind: 'image', mimeType: blob.type || 'image/png', blob })
            await db.storyboards.update(shot.id, { endImageAssetId: asset.id })
          })
          current = (await db.storyboards.get(shot.id)) ?? current
        } catch (e) {
          if (signal.aborted) throw e
          lipSyncNotes.push(`镜头 ${shot.sequence} 运镜终点画面未生成（${String(e).slice(0, 80)}），按首帧生成视频`)
        }
      const renderVideo = (provider: Provider, audio?: string) =>
        operation(
          'video:' + shot.id,
          async () => {
            for await (const e of generateShotVideo({
              provider,
              audioUrl: audio,
              storyboard: current,
              aspectRatio: preset.aspectRatio,
              resolution: preset.resolution,
              signal,
            })) {
              if (e.phase === 'error') throw new Error(e.message || '视频生成失败')
              if (e.phase !== 'processing' && e.phase !== 'queued')
                await report(`镜头 ${shot.sequence} ${e.message || e.phase}`)
            }
          },
          !current.pendingVideoTask,
        )
      const staleTask = !!current.pendingVideoTask
      try {
        try {
          await renderVideo(videoProvider, audioUrl)
        } catch (e) {
          // A task left from an earlier run that the provider rejected for its first-frame field never
          // generated anything; it is cleared now, so submit a fresh one in the current format.
          if (
            !signal.aborted &&
            staleTask &&
            videoProvider !== lipModel &&
            formatFromRejection(400, String(e)) &&
            !(await db.storyboards.get(shot.id))?.pendingVideoTask
          ) {
            await report(`镜头 ${shot.sequence}：原任务因首帧格式被拒，按当前格式重新提交`)
            current = (await db.storyboards.get(shot.id)) ?? current
            await renderVideo(videoProvider)
          } else if (
            !signal.aborted &&
            resolutionFromRejection(String(e)) &&
            !(await db.storyboards.get(shot.id))?.pendingVideoTask
          ) {
            // The model lacks the chosen resolution; the client now submits one it supports.
            // A lip-sync shot stays lip-synced: the same voice drives the resubmission.
            await report(`镜头 ${shot.sequence}：模型不支持所选分辨率，改用它支持的分辨率重新提交`)
            current = (await db.storyboards.get(shot.id)) ?? current
            await renderVideo(videoProvider, videoProvider === lipModel ? audioUrl : undefined)
          } else {
            // The lip-sync model was rejected (not enabled / bad parameter): render the shot normally.
            if (signal.aborted || videoProvider !== lipModel || !audioUrl || !/HTTP 4\d\d|InvalidParameter|Model|模型|audio|音频/i.test(String(e)))
              throw e
            if ((await db.storyboards.get(shot.id))?.pendingVideoTask) throw e
            lipSyncNotes.push(`镜头 ${shot.sequence} 口型同步模型不可用（${String(e).slice(0, 100)}），已按普通视频生成`)
            videoProvider = providers.image2video!
            current = (await db.storyboards.get(shot.id)) ?? current
            await renderVideo(videoProvider)
          }
        }
        const synced = videoProvider === lipModel
        const saved = await db.storyboards.get(shot.id)
        // The voice starts at frame 0 of a lip-synced clip: never trim its head.
        const edit =
          synced && saved?.edit && saved.edit.trimInSec > 0
            ? { ...saved.edit, trimOutSec: Math.round((saved.edit.trimOutSec - saved.edit.trimInSec) * 25) / 25, trimInSec: 0 }
            : saved?.edit
        await db.storyboards.update(shot.id, { lipSynced: synced, edit })
        if (!synced && audioUrl) lipBroken = true
        videosDone++
        await report(`镜头 ${shot.sequence} 视频已保存`)
      } catch (e) {
        if (signal.aborted) throw e
        const saved = await db.storyboards.get(shot.id)
        if (saved?.pendingVideoTask) await markOperation('video:' + shot.id, 'done')
        failures.push(`镜头 ${shot.sequence} 视频：${String(e)}`)
      }
    }
    // Voice runs one at a time (TTS rate limits are low) and stops after the first hard
    // rejection, so a wrong model/voice setting costs one diagnostic error, not fifteen.
    let voiceBlocked = ''
    /** 生成（或复用）本镜配音；同一镜头的并发调用共用一次请求。 */
    const voiceJobs = new Map<string, Promise<Blob | undefined>>()
    const ensureVoice = (shot: (typeof shots)[number]) => {
      const job = voiceJobs.get(shot.id) ?? voiceJob(shot)
      voiceJobs.set(shot.id, job)
      job.catch(() => voiceJobs.delete(shot.id))
      return job
    }
    const voiceJob = async (shot: (typeof shots)[number]): Promise<Blob | undefined> => {
      check()
      if (!shot.narration?.trim()) return undefined
      const tts = providers.tts!
      const cast = await db.characters.where('projectId').equals(id).toArray()
      const speaker = cast.find((c) => c.name === shot.speaker)
      const inner = shot.speaker === '内心'
      const owner = speaker ?? (inner ? cast.find((c) => shot.characterIds.includes(c.id)) ?? cast[0] : undefined)
      // Characters speak in their own voices; the narrator keeps the project voice.
      const voice =
        preset.audio === 'dialogue' && owner?.voice
          ? owner.voice
          : preset.audio === 'dialogue' && !owner
            ? NARRATOR_VOICE
            : preset.voice
      // 自动复用百炼 Key 时用设置页的配音模型；单独添加的语音服务以它自己的模型为准。
      const derived = tts.id === 'auto-bailian-tts'
      const model = derived && preset.ttsModel !== 'auto' ? preset.ttsModel : tts.model
      const acting =
        preset.audio === 'dialogue' && ((derived && preset.ttsModel === 'auto') || /instruct/i.test(model))
      const instructions = [
        inner ? '内心独白，轻声、贴近耳边、气息感强，不要表演腔' : '',
        shot.delivery ?? '',
        preset.audio === 'dialogue' && !inner && owner ? '像真人演员在戏里自然说话，不要播音腔和朗读腔' : '',
      ]
        .filter(Boolean)
        .join('；')
      const fingerprint = JSON.stringify([shot.narration, tts.id, model, voice, acting ? instructions : ''])
      // The voice redone at normal pace after an acted take ran too long (see below).
      const plainFingerprint = JSON.stringify([shot.narration, tts.id, model, voice, '', 'plain'])
      const latest = (await db.storyboards.get(shot.id)) ?? shot
      // Shot length was planned at normal speech pace; the edit can speed a voice up to MAX_VOICE_TEMPO.
      const tooLong = async (blob: Blob) => {
        const sec = wavDurationSec(new Uint8Array(await blob.arrayBuffer()))
        return sec !== undefined && sec > getEditedDuration(latest) * MAX_VOICE_TEMPO
      }
      const store = async (blob: Blob, print: string) => {
        const asset = await createAsset({ projectId: id, kind: 'audio', mimeType: blob.type || 'audio/mpeg', blob })
        await db.storyboards.update(shot.id, { audioAssetId: asset.id, audioFingerprint: print })
        return blob
      }
      // An acted take (e.g. “语速偏慢”) can run far past the shot. Unless a lip-synced clip was already
      // animated to it, redo it once without acting directions rather than failing the edit.
      const plainRetake = async () => {
        let out: Blob | undefined
        await report(`镜头 ${shot.sequence}：配音超出镜长，按正常语速重配`)
        await operation('voice-plain:' + shot.id, async () => {
          out = await store(
            await generateTtsAudio(tts, {
              model,
              text: shot.narration!,
              voice,
              language: preset.language === 'English' ? 'English' : 'Chinese',
              signal,
            }),
            plainFingerprint,
          )
        })
        return out
      }
      if ((latest.audioFingerprint === fingerprint || latest.audioFingerprint === plainFingerprint) && latest.audioAssetId) {
        const existing = await db.assets.get(latest.audioAssetId)
        if (existing) {
          if (acting && latest.audioFingerprint === fingerprint && !latest.lipSynced && (await tooLong(existing.blob)))
            return plainRetake()
          return existing.blob
        }
      }
      await report(`镜头 ${shot.sequence}：${owner && !inner ? `「${owner.name}」配音` : inner ? '内心独白配音' : '旁白配音'}`)
      let out: Blob | undefined
      await operation('voice:' + shot.id, async () => {
        const blob = await generateTtsAudio(tts, {
          model,
          text: shot.narration!,
          voice,
          instructions: acting ? instructions : undefined,
          language: preset.language === 'English' ? 'English' : 'Chinese',
          signal,
        })
        out = await store(blob, fingerprint)
      })
      if (out && acting && !latest.lipSynced && (await tooLong(out))) return plainRetake()
      return out
    }
    const voiceTask = async (shot: (typeof shots)[number]) => {
      check()
      if (!shot.narration?.trim() || voiceBlocked) return
      try {
        await ensureVoice(shot)
        voicesDone++
      } catch (e) {
        if (signal.aborted) throw e
        failures.push(`镜头 ${shot.sequence} 旁白：${String(e)}`)
        if (!voicesDone && /HTTP 4\d\d/.test(String(e))) {
          voiceBlocked = String(e)
          failures.push('其余镜头的旁白已暂停提交：请先按上面的提示修正语音设置，再点“继续制作”（已生成的画面和视频会保留）')
        }
      }
    }
    await Promise.all([
      // Continuous shots form chains that must render in order; independent chains run in parallel.
      runPool(buildChains(shots), preset.concurrency, async (chain) => {
        for (const [k, shot] of chain.entries())
          await shotTask(shot, chain[k - 1]).finally(() => imageSettled.get(shot.id)?.())
      }),
      usesVoice(preset) ? runPool(shots, 1, voiceTask) : Promise.resolve(),
    ])
    if (failures.length)
      throw new Error(
        failures.sort((a, b) => a.localeCompare(b, 'zh', { numeric: true })).join('\n'),
      )
    check()
    prod = await get()
    shots = await db.storyboards.where('projectId').equals(id).sortBy('sequence')
    const timeline = buildEditTimeline(shots, preset)
    if (
      prod.composition?.fingerprint !== timeline.fingerprint ||
      !(await db.assets.get(prod.composition.assetId))
    ) {
      await setStage('compose', '按分镜裁剪、处理声音并拼接完整时间线')
      await composeProject(
        id,
        (p) => {
          void patchRun(id, {
            detail: `剪辑合成 · ${p.phase}${p.ratio !== undefined ? ` ${Math.round(p.ratio * 100)}%` : ''}`,
            completed: p.currentClip ?? 0,
            total: p.totalClips ?? shots.length,
          })
        },
        signal,
      )
    }
    await setStage('package', '正在整理成片、字幕、原文与分镜')
    const blob = await buildProductionPackage(project)
    check()
    const asset = await createAsset({
      projectId: id,
      kind: 'doc',
      mimeType: 'application/zip',
      blob,
    })
    await db.productions.update(id, { packageAssetId: asset.id })
    await db.projects.update(id, { status: 'done', updatedAt: Date.now() })
    await patchRun(id, {
      status: 'done',
      detail: ['成片和成片包已保存，可以预览、下载和检查观感', ...lipSyncNotes].join('\n'),
      error: undefined,
      completed: shots.length,
      total: shots.length,
    })
  } catch (error) {
    const latest = await get()
    if (signal.aborted) {
      if (latest.automation?.status === 'running')
        await patchRun(id, { status: 'paused', detail: '任务已暂停' })
    } else
      await patchRun(id, {
        status: 'failed',
        stage,
        error: error instanceof Error ? error.message : String(error),
        detail: '已保留成功结果，请修复当前问题后继续',
      })
  }
}

export async function replaceSource(id: string, text: string) {
  const prod = await db.productions.get(id)
  if (!prod) throw new Error('项目不存在')
  if (isPipelineActive(id) || prod.automation?.status === 'running')
    throw new Error('请先暂停自动制作再修改小说。')
  const shots = await db.storyboards.where('projectId').equals(id).toArray()
  if (shots.some((s) => s.pendingVideoTask)) throw new Error('仍有远端视频任务，请先完成查询。')
  const chapters = splitChapters(text)
  if (!chapters.length) throw new Error('正文不能为空')
  // Archive the previous source and metadata before detaching the derived shot records.
  const archive = new Blob([JSON.stringify({ production: prod, shots }, null, 2)], {
    type: 'application/json',
  })
  await createAsset({ projectId: id, kind: 'doc', mimeType: 'application/json', blob: archive })
  await db.transaction(
    'rw',
    [db.productions, db.storyboards, db.characters, db.materials],
    async () => {
      await db.storyboards.where('projectId').equals(id).delete()
      await db.characters.where('projectId').equals(id).delete()
      await db.materials.add({
        id: crypto.randomUUID(),
        projectId: id,
        kind: 'txt',
        name: '小说修订.txt',
        text,
        createdAt: Date.now(),
      })
      await db.productions.put({
        ...prod,
        chapters,
        selectedId: chapters[0].id,
        sourceHash: undefined,
        plan: undefined,
        promptsReady: false,
        composition: undefined,
        exportedAt: undefined,
        packageAssetId: undefined,
        novel: undefined,
        automation: {
          ...newAutomation(),
          status: 'paused',
          submissions: prod.automation?.submissions ?? 0,
          detail: '小说已修订。角色、方案、分镜和成片需要更新，旧素材及版本已归档。',
        },
      })
    },
  )
  await flushLocalStore()
}
