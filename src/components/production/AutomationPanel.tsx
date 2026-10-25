import { useEffect, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, flushLocalStore } from '@/core/storage/db'
import { useSettingsStore } from '@/store/settings'
import { parseFile } from '@/core/parsers'
import { saveMaterial } from '@/core/storage/materials'
import { createProject } from '@/core/storage/projects'
import { createAsset } from '@/core/storage/assets'
import { splitChapters } from '@/core/pipeline/chapters'
import { writeNovel, storyWordsFor } from '@/core/pipeline/directing'
import {
  newAutomation,
  runPipeline,
  queuePipeline,
  stopPipeline,
  isPipelineActive,
  stageLabels,
  replaceSource,
} from '@/core/pipeline/runner'
import {
  readPreset,
  normalizePreset,
  resolveProviders,
  preflight,
  resolveAudio,
  isQwenTts,
  QWEN_VOICES,
  usesVoice,
  lipSyncProvider,
  TTS_MODELS,
  DURATIONS,
  storyboardTimed,
  type Duration,
  type Resolution,
  type ProductionPreset,
} from '@/core/pipeline/presets'
import { publishText, buildCover } from '@/core/export/production'
import { referenceProvider } from '@/core/image/reference'
import { CastStrip } from './CastStrip'
import { triggerDownload } from '@/core/export/json'
import { testProvider } from '@/core/llm/test-connection'
import { PROVIDER_KIND_LABEL } from '@/components/settings/PROVIDER_PRESETS'
import { ingestNovel } from '@/core/pipeline/ingest'
import type { ProviderKind } from '@/types/domain'
import { Disclosure } from '@/components/ui/disclosure'
import { looksLikeScript, referencesExistingVideo } from '@/core/pipeline/request-hints'
const durationLabel = (p: ProductionPreset) => (storyboardTimed(p) ? '时长由分镜决定' : `${p.durationSec} 秒`)

export function AutomationPanel({
  projectId,
  onSelect,
  onBusy,
}: {
  projectId: string
  onSelect: (id: string) => void
  onBusy: (busy: boolean) => void
}) {
  const prod = useLiveQuery(() => db.productions.get(projectId), [projectId])
  const settings = useSettingsStore(),
    [draftPreset, setPreset] = useState<ProductionPreset>(readPreset),
    [entry, setEntry] = useState<'oneLine' | 'scene' | 'upload' | 'novel'>('oneLine')
  const [line, setLine] = useState(''),
    [sceneText, setSceneText] = useState(''),
    [copied, setCopied] = useState(false)
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId])
  const [idea, setIdea] = useState(''),
    [genre, setGenre] = useState('现代都市言情'),
    [words, setWords] = useState(1500),
    [autoNovel, setAutoNovel] = useState(false)
  const [creating, setCreating] = useState(false),
    [error, setError] = useState(''),
    [connection, setConnection] = useState(''),
    [ack, setAck] = useState(false),
    [editing, setEditing] = useState(false),
    [text, setText] = useState('')
  const run = prod?.automation,
    running = run?.status === 'running' && isPipelineActive(projectId)
  const statusRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (running) statusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [running])
  const pendingShots = useLiveQuery(
    () => db.storyboards.where('projectId').equals(projectId).toArray(),
    [projectId],
    [],
  )
  // New works are always configured from the draft preset (fully editable); the selected
  // project's own preset only governs that project's run and is shown read-only.
  const projectPreset = prod?.preset ? normalizePreset(prod.preset) : undefined
  const preset =
    entry === 'scene' ? normalizePreset({ ...draftPreset, format: 'scene' }) : { ...draftPreset, format: 'drama' as const }
  const providers = resolveProviders(preset, settings.providers, settings.activeProviderIds),
    issues = preflight(preset, providers)
  useEffect(() => {
    onBusy(creating || !!running)
  }, [creating, running, onBusy])
  useEffect(() => {
    if (prod?.automation?.status !== 'queued') return
    const selected = resolveProviders(
      normalizePreset(prod.preset),
      settings.providers,
      settings.activeProviderIds,
    )
    void runPipeline(projectId, selected, settings.models).catch((e) => setError(String(e)))
  }, [
    projectId,
    prod?.automation?.status,
    prod?.preset,
    settings.providers,
    settings.activeProviderIds,
    settings.models,
  ])
  // Settings that only matter while a project is running also apply to the selected project.
  const RUNTIME_KEYS: (keyof ProductionPreset)[] = [
    'concurrency',
    'maxSubmissions',
    'consistency',
    'providers',
    'voice',
    'burnSubtitles',
    'titleCard',
    'lipSync',
    'bgm',
  ]
  async function change(patch: Partial<ProductionPreset>) {
    const next = normalizePreset({ ...draftPreset, ...patch })
    setPreset(next)
    localStorage.setItem('studio-preset', JSON.stringify(next))
    const runtime = Object.fromEntries(
      Object.entries(patch).filter(([k]) => RUNTIME_KEYS.includes(k as keyof ProductionPreset)),
    )
    if (prod && projectPreset && !running && Object.keys(runtime).length) {
      await db.productions.update(projectId, {
        preset: normalizePreset({ ...projectPreset, ...runtime }),
        packageAssetId: undefined,
      })
      await flushLocalStore()
    }
  }
  /** 只改当前作品的输出设置（字幕、标题、配乐、费用上限），不影响新作品的默认值。 */
  async function changeProject(patch: Partial<ProductionPreset>) {
    if (!prod || !projectPreset || running) return
    await db.productions.update(projectId, {
      preset: normalizePreset({ ...projectPreset, ...patch }),
      packageAssetId: undefined,
    })
    await flushLocalStore()
  }
  /** 背景音乐存进本机素材库，随预设引用；成片时循环铺满并随对白自动压低。 */
  async function pickBgm(file: File, apply: (patch: Partial<ProductionPreset>) => Promise<void> = change, volume = preset.bgm?.volume) {
    try {
      if (file.size > 40 * 1024 * 1024) throw new Error('音乐文件超过 40MB，请先压缩或剪短')
      const asset = await createAsset({ projectId: 'music-library', kind: 'audio', mimeType: file.type || 'audio/mpeg', blob: file })
      await apply({ bgm: { assetId: asset.id, name: file.name.replace(/\.[^.]+$/, ''), volume: volume ?? 0.22 } })
      await flushLocalStore()
    } catch (e) {
      setError(String(e))
    }
  }
  /** 场景短片：直接以场景描述为原文，跳过写小说，生成单场景的连贯短片。 */
  async function sceneFilm() {
    const description = sceneText.trim()
    setCreating(true)
    setError('')
    try {
      if (issues.length) throw new Error(issues.join('；'))
      const effective = resolveAudio({ ...preset, mode: 'automatic', format: 'scene' }, providers)
      const title = description.replace(/\s+/g, ' ').slice(0, 16)
      const created = await createProject({ title: `场景短片·${title}`, style: effective.style }),
        file = new File([description], title + '.txt', { type: 'text/plain;charset=utf-8' })
      await saveMaterial(created.id, await parseFile(file))
      const chapters = [{ id: 'scene', title: '场景', text: description }]
      await db.productions.put({
        projectId: created.id,
        chapters,
        selectedId: 'scene',
        preset: effective,
        autoCompose: false,
        automation: { ...newAutomation(), status: 'queued', detail: '开始设计单场景短片' },
      })
      await flushLocalStore()
      onSelect(created.id)
    } catch (e) {
      setError(String(e))
    } finally {
      setCreating(false)
    }
  }
  async function upload(file: File) {
    setCreating(true)
    setError('')
    try {
      onSelect(await ingestNovel(file, preset))
    } catch (e) {
      setError(String(e))
    } finally {
      setCreating(false)
    }
  }
  async function oneLine() {
    const text = line.trim()
    setCreating(true)
    setError('')
    try {
      if (!providers.llm) throw new Error('请先配置文本模型')
      if (issues.length) throw new Error(issues.join('；'))
      const effective = resolveAudio({ ...preset, mode: 'automatic' }, providers)
      if (looksLikeScript(text)) {
        const title = (text.split('\n')[0].replace(/[《》#*\s]/g, '') || text).slice(0, 16)
        const id = await ingestNovel(new File([text], title + '.txt', { type: 'text/plain;charset=utf-8' }), effective)
        await db.productions.update(id, { idea: text })
        await flushLocalStore()
        onSelect(id)
        return
      }
      const result = await writeNovel(
        providers.llm,
        JSON.stringify({
          idea: text,
          targetWords: storyWordsFor(effective.durationSec),
          videoDurationSec: effective.durationSec,
          aspectRatio: effective.aspectRatio,
          language: effective.language,
        }),
        AbortSignal.timeout(300000),
        'oneLine',
      )
      const created = await createProject({ title: result.title, style: effective.style }),
        file = new File([result.text], result.title + '.txt', { type: 'text/plain;charset=utf-8' })
      await saveMaterial(created.id, await parseFile(file))
      const chapters = splitChapters(result.text)
      await db.productions.put({
        projectId: created.id,
        chapters,
        selectedId: chapters[0].id,
        preset: effective,
        novel: result,
        idea: text,
        autoCompose: false,
        automation: {
          ...newAutomation(),
          status: 'queued',
          submissions: 1,
          detail: '故事已写好，开始改编、出图、出视频与剪辑',
        },
      })
      await flushLocalStore()
      onSelect(created.id)
    } catch (e) {
      setError(String(e))
    } finally {
      setCreating(false)
    }
  }
  async function novel() {
    setCreating(true)
    setError('')
    try {
      if (!providers.llm) throw new Error('请先配置文本模型')
      if (!Number.isFinite(words) || words < 500 || words > 8000)
        throw new Error('目标篇幅请选择500–8000字')
      if (autoNovel && issues.length) throw new Error(issues.join('；'))
      const result = await writeNovel(
        providers.llm,
        JSON.stringify({ idea, genre, targetWords: words, language: preset.language }),
        AbortSignal.timeout(300000),
      )
      const project = await createProject({ title: result.title, style: preset.style }),
        file = new File([result.text], result.title + '.txt', { type: 'text/plain;charset=utf-8' })
      await saveMaterial(project.id, await parseFile(file))
      const chapters = splitChapters(result.text)
      await db.productions.put({
        projectId: project.id,
        chapters,
        selectedId: chapters[0].id,
        preset: resolveAudio(preset, providers),
        novel: result,
        autoCompose: false,
        automation: {
          ...newAutomation(),
          status: autoNovel ? 'queued' : 'paused',
          submissions: 1,
          detail: autoNovel ? '小说已保存，开始改编' : '小说已保存，请审稿后继续制作',
        },
      })
      await flushLocalStore()
      onSelect(project.id)
    } catch (e) {
      setError(String(e))
    } finally {
      setCreating(false)
    }
  }
  async function resume() {
    setError('')
    try {
      await queuePipeline(projectId, ack)
      setAck(false)
    } catch (e) {
      setError(String(e))
    }
  }
  async function connections() {
    setConnection('正在检测接口连接；不会提交图片或视频生成')
    const messages = []
    for (const kind of [
      'llm',
      'text2image',
      'image2video',
      ...(usesVoice(preset) || preset.audio === 'auto' ? ['tts'] : []),
    ] as ProviderKind[]) {
      const p = providers[kind]
      if (!p) {
        messages.push(`${PROVIDER_KIND_LABEL[kind]}：未配置`)
        continue
      }
      const result = await testProvider(p, { signal: AbortSignal.timeout(15000) })
      messages.push(
        `${PROVIDER_KIND_LABEL[kind]}：${result.ok ? result.warning || '模型列表接口已连通；尚未验证生成权限' : result.error}`,
      )
    }
    setConnection(messages.join('\n'))
  }
  const uncertain = Object.entries(run?.operations ?? {}).some(
    ([key, v]) =>
      v.status === 'started' &&
      !pendingShots.some((s) => s.pendingVideoTask && key === 'video:' + s.id),
  )
  const tts = providers.tts
  const voiceLabel = QWEN_VOICES.find((v) => v.id === preset.voice)?.label ?? preset.voice
  const dialogue = preset.audio === 'dialogue' || (preset.audio === 'auto' && !!tts)
  const audioSummary =
    preset.audio === 'original'
      ? '保留视频原声（不配音）'
      : !tts
        ? usesVoice(preset)
          ? '配音：未配置语音服务'
          : '未配置语音服务，成片保留视频原声'
        : dialogue
          ? `角色对白配音：每个角色独立音色 + 情绪表演（百炼 Qwen-TTS），原声压低作环境声`
          : `解说旁白：${tts.id === 'auto-bailian-tts' ? '百炼 Qwen-TTS' : tts.label} · ${voiceLabel}`
  const examples = [
    '被全公司嘲笑的保洁阿姨，其实是集团失踪多年的董事长',
    '外卖小哥送错一单，意外救下了要跳楼的千金',
    '婚礼当天，新郎当众念出了新娘的出轨证据',
    '重生回高考前一天，我决定不再替妹妹顶罪',
  ]
  const refReady = !!referenceProvider(providers.text2image, settings.models.reference)
  const lipReady = !!lipSyncProvider(providers.image2video, settings.models.lipSync)
  const ttsLabel = !providers.tts
    ? '未配置语音服务'
    : providers.tts.id === 'auto-bailian-tts'
      ? (TTS_MODELS.find((m) => m.id === settings.models.tts)?.label ?? settings.models.tts)
      : `${providers.tts.label} · ${providers.tts.model}`
  const consistencyHint = !preset.consistency
    ? ''
    : refReady
      ? '（定妆照）'
      : '（需百炼图像服务）'
  const done = run?.status === 'done' && !!prod?.composition
  const percent = run?.total ? Math.round((run.completed / run.total) * 100) : 0
  const btn =
    'rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-40 hover:border-accent'
  const field = 'rounded-lg border border-border bg-background-soft px-3 py-2 text-sm'
  const primary =
    'rounded-xl bg-accent px-6 py-3 text-base font-semibold text-accent-foreground shadow disabled:opacity-40'
  const modeCard = (active: boolean) =>
    'flex flex-col gap-1 rounded-xl border p-3 text-left transition-colors disabled:opacity-50 ' +
    (active ? 'border-accent bg-accent/10' : 'border-border hover:border-accent/60')
  const ENTRIES = [
    { id: 'oneLine', title: '编一个短剧故事', hint: '给一个点子，AI 编剧情、分镜和对白' },
    { id: 'scene', title: '照我的描述拍一段', hint: '写清画面和动作，原样拍出来，不加戏' },
    { id: 'upload', title: '用我的小说或剧本', hint: '上传 TXT / Markdown / Word，按原文改编' },
  ] as const
  const AUDIO_LABEL: Record<ProductionPreset['audio'], string> = {
    auto: '自动配音',
    dialogue: '角色对白配音',
    narration: '解说旁白',
    original: '保留视频原声',
  }
  const existingVideo =
    (entry === 'oneLine' || entry === 'scene') && referencesExistingVideo(entry === 'scene' ? sceneText : line)
  const firstStep = { oneLine: '写故事', scene: '按描述设计镜头', upload: '改编原文', novel: '写小说' }[entry]
  return (
    <section
      className="mb-6 space-y-4 rounded-2xl border border-accent/40 bg-background-soft p-5 md:p-6"
      aria-label="自动生产控制台"
    >
      {projectId ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{project?.title ?? '作品'}</h2>
            {projectPreset && (
              <p className="text-xs text-muted">
                {projectPreset.format === 'scene' ? '场景短片' : '短剧'} · {durationLabel(projectPreset)} ·{' '}
                {projectPreset.aspectRatio} · {projectPreset.resolution} · {AUDIO_LABEL[projectPreset.audio]}
              </p>
            )}
          </div>
          <button className={btn + ' ml-auto'} disabled={creating || running} onClick={() => onSelect('')}>
            ＋ 新建作品
          </button>
        </div>
      ) : (
        <>
          <div>
            <h2 className="text-lg font-semibold">新建作品</h2>
            <p className="text-sm text-muted">选一种方式，写下你想要的视频，确认设置后开始生成。</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="创作方式">
            {ENTRIES.map((x) => {
              const active = entry === x.id || (x.id === 'upload' && entry === 'novel')
              return (
                <button
                  key={x.id}
                  role="radio"
                  aria-checked={active}
                  className={modeCard(active)}
                  disabled={creating}
                  onClick={() => setEntry(x.id)}
                >
                  <span className="text-sm font-medium">{x.title}</span>
                  <span className="text-xs text-muted">{x.hint}</span>
                </button>
              )
            })}
          </div>
          {entry === 'oneLine' && (
            <div className="space-y-3">
              <textarea
                aria-label="一句话创意"
                className={
                  'w-full rounded-xl border border-border bg-background px-4 py-3 focus:border-accent focus:outline-none ' +
                  (looksLikeScript(line) ? 'min-h-56 text-base leading-7' : 'min-h-24 text-lg leading-8')
                }
                value={line}
                maxLength={3000}
                disabled={creating}
                onChange={(e) => setLine(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && line.trim().length >= 6 && !issues.length)
                    void oneLine()
                }}
                placeholder="一句话说出你的故事点子：谁、遇到了什么反差或冲突、想要什么结局（也可以直接粘贴写好的剧本或分镜）"
              />
              {looksLikeScript(line) ? (
                <p className="text-xs text-accent">
                  看起来你贴的是剧本或分镜：会直接按你的原文改编和分镜，不再由 AI 另写故事。
                </p>
              ) : (
                <p className="text-xs text-muted">
                  AI 会按你的点子写成短剧：你写到的人物、关系和结局都会保留，不会凭空加人或改设定。
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted">试试：</span>
                {examples.map((x) => (
                  <button
                    key={x}
                    className="rounded-full border border-border px-3 py-1 text-xs text-muted hover:border-accent hover:text-foreground"
                    disabled={creating}
                    onClick={() => setLine(x)}
                  >
                    {x}
                  </button>
                ))}
              </div>
            </div>
          )}
          {entry === 'scene' && (
            <div className="space-y-2">
              <textarea
                aria-label="场景描述"
                className="w-full min-h-28 rounded-xl border border-border bg-background px-4 py-3 text-base leading-7 focus:border-accent focus:outline-none"
                value={sceneText}
                maxLength={6000}
                disabled={creating}
                onChange={(e) => setSceneText(e.target.value)}
                placeholder="写清楚要拍什么：地点与时间、人物（外貌服装）、依次发生的动作、镜头怎么动、想要的情绪。例如：深夜便利店，穿红色雨衣的女孩推门进来，头发滴着水，把一张旧车票放在收银台上，店员愣住；镜头从门口缓慢推近到店员的眼神。"
              />
              <p className="text-xs text-muted">
                按你写的内容原样拍：不会新增情节、人物或反转；你写到的镜头运动（环绕、推近、拉远等）都会拍出来。同一场景、连续时间，适合氛围短片、产品或人物小片。
              </p>
            </div>
          )}
          {existingVideo && (
            <p className="rounded-lg border border-amber-500/40 p-3 text-sm text-amber-200">
              看起来你想修改一段已有的视频（比如 MV 或电影片段）。生产台读取不了、也改不了原视频，只能按文字重新生成一段相似的画面
              {entry === 'scene'
                ? '：会尽量还原原作可辨识的场景、服装和动作，只换你指定的人物'
                : '。建议改用「照我的描述拍一段」，它会尽量还原原作的场景、服装和动作，只换你指定的人物'}
              ；画面不会是原片，也不会模仿真人的长相。
            </p>
          )}
          {entry === 'upload' && (
            <div className="space-y-1 text-sm">
              <p className="text-muted">上传后按原文改编：角色、分场、分镜、首帧、视频、配音和剪辑都会自动完成。</p>
              <button className="text-xs text-accent underline" disabled={creating} onClick={() => setEntry('novel')}>
                还没有小说？让 AI 先写一篇 →
              </button>
            </div>
          )}
          {entry === 'novel' && (
            <div className="space-y-3 text-sm">
              <button className="text-xs text-accent underline" disabled={creating} onClick={() => setEntry('upload')}>
                ← 我已有小说，直接上传
              </button>
              <label className="block text-xs text-muted">
                故事创意、人物关系、爽点与结局
                <textarea
                  aria-label="小说创意"
                  className={field + ' mt-1 min-h-28 w-full text-foreground'}
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  placeholder="例如：地铁相识，从一双手开始心动；工作署名被抢后凭证据反击，感情慢慢升温，圆满结局。"
                />
              </label>
              <div className="flex flex-wrap items-end gap-3">
                <label className="space-y-1">
                  <span className="block text-xs text-muted">题材</span>
                  <input className={field} value={genre} onChange={(e) => setGenre(e.target.value)} />
                </label>
                <label className="space-y-1">
                  <span className="block text-xs text-muted">目标字数</span>
                  <input
                    className={field + ' w-24'}
                    type="number"
                    min="500"
                    max="8000"
                    value={words}
                    onChange={(e) => setWords(Number(e.target.value))}
                  />
                </label>
                <label className="flex items-center gap-2 py-2">
                  <input type="checkbox" checked={autoNovel} onChange={(e) => setAutoNovel(e.target.checked)} />
                  写完后自动制作成短剧（不勾选则先审稿）
                </label>
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <label className="space-y-1">
              <span className="block text-xs text-muted">时长</span>
              <select
                aria-label="成片时长"
                className={field}
                value={storyboardTimed(preset) ? 'storyboard' : preset.durationSec}
                disabled={creating}
                onChange={(e) =>
                  void change(
                    e.target.value === 'storyboard'
                      ? { durationMode: 'storyboard' }
                      : { durationSec: Number(e.target.value) as Duration, durationMode: 'fixed' },
                  )
                }
              >
                {preset.format === 'scene' && <option value="storyboard">由分镜决定 · 按动作自然时长</option>}
                {DURATIONS.map((n) => (
                  <option key={n} value={n}>
                    {n} 秒{n === 15 ? ' · 小短片' : n >= 90 ? ' · 长' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-xs text-muted">分辨率</span>
              <select
                aria-label="分辨率"
                className={field}
                value={preset.resolution}
                disabled={creating}
                onChange={(e) => void change({ resolution: e.target.value as Resolution })}
              >
                <option value="480P">480P · 省钱打样</option>
                <option value="720P">720P · 推荐</option>
                <option value="1080P">1080P · 高清（更贵）</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-xs text-muted">画幅</span>
              <select
                aria-label="画幅"
                className={field}
                value={preset.aspectRatio}
                disabled={creating}
                onChange={(e) => void change({ aspectRatio: e.target.value as '9:16' | '16:9' })}
              >
                <option value="9:16">9:16 竖屏</option>
                <option value="16:9">16:9 横屏</option>
              </select>
            </label>
            {preset.audio === 'narration' && tts && (
              <label className="space-y-1">
                <span className="block text-xs text-muted">旁白音色</span>
                {isQwenTts(tts) ? (
                  <select
                    aria-label="旁白音色"
                    className={field}
                    value={preset.voice}
                    disabled={creating}
                    onChange={(e) => void change({ voice: e.target.value })}
                  >
                    {!QWEN_VOICES.some((v) => v.id === preset.voice) && (
                      <option value={preset.voice}>{preset.voice}</option>
                    )}
                    {QWEN_VOICES.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    aria-label="旁白音色"
                    className={field + ' w-28'}
                    value={preset.voice}
                    disabled={creating}
                    onChange={(e) => void change({ voice: e.target.value })}
                  />
                )}
              </label>
            )}
            <label className="flex items-center gap-2 py-2">
              <input
                type="checkbox"
                checked={preset.burnSubtitles}
                disabled={creating}
                onChange={(e) => void change({ burnSubtitles: e.target.checked })}
              />
              字幕烧录进画面
            </label>
            <label
              className="flex items-center gap-2 py-2"
              title="先为主要角色生成定妆照，之后每镜都按定妆照出图，保持长相和服装一致"
            >
              <input
                type="checkbox"
                checked={preset.consistency}
                disabled={creating}
                onChange={(e) => void change({ consistency: e.target.checked })}
              />
              角色一致性{consistencyHint}
            </label>
            <label className="flex items-center gap-2 py-2">
              <input
                type="checkbox"
                checked={preset.titleCard}
                disabled={creating}
                onChange={(e) => void change({ titleCard: e.target.checked })}
              />
              片头大标题
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/60 p-3 text-sm">
            <span className="w-full text-xs font-medium text-muted">声音</span>
            <label className="space-y-1">
              <span className="block text-xs text-muted">声音方式</span>
              <select
                aria-label="声音方式"
                className={field}
                value={preset.audio}
                disabled={creating}
                onChange={(e) => void change({ audio: e.target.value as ProductionPreset['audio'] })}
              >
                <option value="auto">自动（有语音服务就做角色对白）</option>
                <option value="dialogue">角色对白 · 分角色配音</option>
                <option value="narration">解说旁白</option>
                <option value="original">保留视频原声</option>
              </select>
            </label>
            <div className="space-y-1">
              <span className="block text-xs text-muted">配音模型</span>
              <span className="flex items-center gap-2 py-2 text-sm">
                {ttsLabel}
                <Link className="text-xs text-accent underline" to="/settings">
                  在设置中更改
                </Link>
              </span>
            </div>
            <label
              className="flex items-center gap-2 py-2"
              title="角色正脸说台词的镜头，先配音再用配音驱动视频模型生成口型（万相 2.6 等支持音频驱动的模型）"
            >
              <input
                type="checkbox"
                checked={preset.lipSync}
                disabled={creating || (preset.audio !== 'dialogue' && preset.audio !== 'auto')}
                onChange={(e) => void change({ lipSync: e.target.checked })}
              />
              口型同步{preset.lipSync && !lipReady ? '（需百炼视频服务）' : ''}
            </label>
            <BgmPicker
              bgm={preset.bgm}
              disabled={creating}
              onPick={(f) => void pickBgm(f)}
              onVolume={(volume) => void change({ bgm: { ...preset.bgm!, volume } })}
              onClear={() => void change({ bgm: undefined })}
            />
          </div>
          <Disclosure summary="高级：模式、档位、声音、模型与费用上限">
            <div className="grid gap-3 md:grid-cols-2">
              <label>
                工作模式
                <select
                  aria-label="工作模式"
                  className={field + ' w-full'}
                  value={preset.mode}
                  disabled={running}
                  onChange={(e) => void change({ mode: e.target.value as ProductionPreset['mode'] })}
                >
                  <option value="automatic">自动模式 · 一路做到成片</option>
                  <option value="professional">专业模式 · 逐步调整</option>
                </select>
              </label>
              <label>
                制作档位
                <select
                  aria-label="制作档位"
                  className={field + ' w-full'}
                  value={preset.budget}
                  disabled={running || !!prod?.promptsReady}
                  onChange={(e) => void change({ budget: e.target.value as ProductionPreset['budget'] })}
                >
                  <option value="economy">节省 · 控制镜数</option>
                  <option value="balanced">均衡 · 按节奏分镜</option>
                  <option value="quality">精修 · 更多反应与细节</option>
                </select>
              </label>

              <label>
                语言
                <select
                  className={field + ' w-full'}
                  value={preset.language}
                  disabled={running || !!prod?.plan}
                  onChange={(e) => void change({ language: e.target.value as '中文' | 'English' })}
                >
                  <option>中文</option>
                  <option>English</option>
                </select>
              </label>
              <label>
                画面风格
                <input
                  className={field + ' w-full'}
                  value={preset.style}
                  disabled={running || !!prod?.plan}
                  onChange={(e) => void change({ style: e.target.value })}
                />
              </label>
              <label>
                同时生成镜头数（1–4）
                <input
                  aria-label="并发镜头数"
                  type="number"
                  min="1"
                  max="4"
                  className={field + ' w-full'}
                  value={preset.concurrency}
                  disabled={running}
                  onChange={(e) => void change({ concurrency: Number(e.target.value) })}
                />
              </label>
              <label>
                本项目最多生成请求数
                <input
                  aria-label="请求次数上限"
                  type="number"
                  min="10"
                  max="200"
                  className={field + ' w-full'}
                  value={preset.maxSubmissions}
                  disabled={running}
                  onChange={(e) => void change({ maxSubmissions: Number(e.target.value) })}
                />
              </label>
              {(['llm', 'text2image', 'image2video', 'tts'] as ProviderKind[]).map((kind) => (
                <label key={kind}>
                  {PROVIDER_KIND_LABEL[kind]}
                  <select
                    className={field + ' w-full'}
                    value={preset.providers[kind] ?? ''}
                    disabled={running}
                    onChange={(e) =>
                      void change({ providers: { ...preset.providers, [kind]: e.target.value } })
                    }
                  >
                    <option value="">
                      {kind === 'tts' ? '使用已激活的语音服务；没有则自动复用百炼 Key' : '使用模型设置中已激活的服务'}
                    </option>
                    {settings.providers
                      .filter((p) => p.kind === kind)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label} · {p.model}
                        </option>
                      ))}
                  </select>
                </label>
              ))}
              <div className="md:col-span-2 flex flex-wrap gap-2">
                <button className={btn} disabled={creating || running} onClick={() => void connections()}>
                  检测模型连接
                </button>
              </div>
              {connection && <pre className="md:col-span-2 whitespace-pre-wrap text-xs text-muted">{connection}</pre>}
              <p className="text-xs text-muted md:col-span-2">
                档位控制镜头数量与细节，不代表供应商价格。请求上限包含文本、图片、视频及语音；查询已有视频任务不计入新提交。并发越高出片越快，但服务商可能限制同时运行的任务数；遇到限流请调低。旁白略长于镜头时自动加速（最多1.35倍），更长会提示精简。
              </p>
            </div>
          </Disclosure>
          {issues.length > 0 && (
            <div className="rounded-lg border border-amber-500/40 p-3 text-sm text-amber-200">
              <p className="mb-1 font-medium">开始前还需要：</p>
              {issues.map((s) => (
                <p key={s}>· {s}</p>
              ))}
              <Link className="underline" to="/settings">
                打开模型设置并修复 →
              </Link>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <p className="min-w-0 flex-1 text-xs text-muted">
              将生成：{durationLabel(preset)} · {preset.aspectRatio} · {preset.resolution} · {audioSummary}。自动完成：
              {firstStep} → 角色 → 分镜 → {preset.consistency && refReady ? '定妆照与场景定场图 → ' : ''}首帧 → 视频（
              {preset.concurrency} 镜并行）→ 配音 → 字幕/标题 → 剪辑 → 成片包与发布文案。
            </p>
            {entry === 'oneLine' && (
              <button
                className={primary}
                disabled={creating || line.trim().length < 6 || issues.length > 0}
                onClick={() => void oneLine()}
              >
                {creating ? '编剧正在写故事…' : '开始生成 ▶'}
              </button>
            )}
            {entry === 'scene' && (
              <button
                className={primary}
                disabled={creating || sceneText.trim().length < 10 || issues.length > 0}
                onClick={() => void sceneFilm()}
              >
                {creating ? '正在创建…' : '开始生成 ▶'}
              </button>
            )}
            {entry === 'upload' && (
              <label
                className={
                  primary +
                  ' cursor-pointer' +
                  (creating || (preset.mode === 'automatic' && issues.length > 0) ? ' pointer-events-none opacity-40' : '')
                }
              >
                {creating ? '正在读取…' : '选择文件并开始 ▶'}
                <input
                  aria-label="上传章节并自动制作"
                  className="hidden"
                  type="file"
                  accept=".txt,.md,.docx"
                  disabled={creating || (preset.mode === 'automatic' && issues.length > 0)}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (f) void upload(f)
                  }}
                />
              </label>
            )}
            {entry === 'novel' && (
              <button
                className={primary}
                disabled={creating || idea.trim().length < 8 || !providers.llm}
                onClick={() => void novel()}
              >
                {creating ? '作家正在创作与修订…' : '开始写小说 ▶'}
              </button>
            )}
          </div>
        </>
      )}
      {projectId && projectPreset && (
        <Disclosure summary="本作品设置：字幕、标题、配乐与费用上限">
          <div className="space-y-3 text-sm">
            <p className="text-xs text-muted">
              只改当前作品。字幕、标题和配乐改完后点「检查变更并继续」，只会重新剪辑合成，不会重做镜头；时长、画幅、分辨率和声音方式在创建时已确定。
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex items-center gap-2 py-2">
                <input
                  type="checkbox"
                  checked={projectPreset.burnSubtitles}
                  disabled={running}
                  onChange={(e) => void changeProject({ burnSubtitles: e.target.checked })}
                />
                字幕烧录进画面
              </label>
              <label className="flex items-center gap-2 py-2">
                <input
                  type="checkbox"
                  checked={projectPreset.titleCard}
                  disabled={running}
                  onChange={(e) => void changeProject({ titleCard: e.target.checked })}
                />
                片头大标题
              </label>
              {projectPreset.audio === 'dialogue' && (
                <label className="flex items-center gap-2 py-2">
                  <input
                    type="checkbox"
                    checked={projectPreset.lipSync}
                    disabled={running}
                    onChange={(e) => void changeProject({ lipSync: e.target.checked })}
                  />
                  口型同步
                </label>
              )}
              <BgmPicker
                bgm={projectPreset.bgm}
                disabled={running}
                onPick={(f) => void pickBgm(f, changeProject, projectPreset.bgm?.volume)}
                onVolume={(volume) => void changeProject({ bgm: { ...projectPreset.bgm!, volume } })}
                onClear={() => void changeProject({ bgm: undefined })}
              />
              <label className="space-y-1">
                <span className="block text-xs text-muted">同时生成镜头数（1–4）</span>
                <input
                  aria-label="并发镜头数"
                  type="number"
                  min="1"
                  max="4"
                  className={field + ' w-24'}
                  value={projectPreset.concurrency}
                  disabled={running}
                  onChange={(e) => void changeProject({ concurrency: Number(e.target.value) })}
                />
              </label>
              <label className="space-y-1">
                <span className="block text-xs text-muted">最多生成请求数</span>
                <input
                  aria-label="请求次数上限"
                  type="number"
                  min="10"
                  max="200"
                  className={field + ' w-24'}
                  value={projectPreset.maxSubmissions}
                  disabled={running}
                  onChange={(e) => void changeProject({ maxSubmissions: Number(e.target.value) })}
                />
              </label>
            </div>
          </div>
        </Disclosure>
      )}
      {projectId && projectPreset?.consistency && <CastStrip projectId={projectId} />}
      {run && run.status !== 'done' && run.total > 0 && (
        <progress className="w-full" max={100} value={percent} aria-label="制作进度" />
      )}
      {done && project && (
        <div className="space-y-3 rounded-xl border border-green-500/40 bg-green-500/5 p-4">
          <p className="font-medium text-green-300">
            ✓ 成片已完成 · {prod!.composition!.durationSec.toFixed(1)} 秒 · 可直接发布
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              className={btn}
              onClick={() => document.getElementById('composition-stage')?.scrollIntoView({ behavior: 'smooth' })}
            >
              预览成片 ↓
            </button>
            <button
              className={btn}
              onClick={() =>
                void db.assets.get(prod!.composition!.assetId).then((a) =>
                  a ? triggerDownload(a.blob, `${project.title.replace(/[\\/:*?"<>|]/g, '-')}-成片.mp4`) : setError('成片文件缺失，请继续制作重新合成'),
                )
              }
            >
              下载 MP4
            </button>
            <button
              className={btn}
              onClick={() =>
                void buildCover(project).then((b) =>
                  b ? triggerDownload(b, `${project.title.replace(/[\\/:*?"<>|]/g, '-')}-封面.jpg`) : setError('没有可用的首帧图片生成封面'),
                )
              }
            >
              下载封面
            </button>
            <button
              className={btn}
              onClick={() =>
                navigator.clipboard
                  .writeText(publishText(prod!, project))
                  .then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  })
                  .catch(() => setError('无法访问剪贴板，请手动选择文案复制'))
              }
            >
              {copied ? '已复制 ✓' : '复制发布文案'}
            </button>
          </div>
          <pre className="whitespace-pre-wrap rounded-lg bg-background p-3 text-sm text-muted">{publishText(prod!, project)}</pre>
        </div>
      )}
      {run && (
        <div
          ref={statusRef}
          role="status"
          className="space-y-3 rounded-lg border border-border p-4"
        >
          <p className="font-medium">
            {run.status === 'done'
              ? '✓ 已完成'
              : running
                ? '● 执行中'
                : run.status === 'failed'
                  ? '! 执行失败'
                  : run.status === 'cancelled'
                    ? '已取消'
                    : run.status === 'paused'
                      ? '已暂停'
                      : run.status === 'queued'
                        ? '等待开始'
                        : '中断，可继续'}{' '}
            · {stageLabels[run.stage]}
          </p>
          <p className="text-sm">{run.detail}</p>
          {run.total > 0 && (
            <p className="text-xs text-muted">
              子任务 {run.completed}/{run.total}
            </p>
          )}
          <p className="text-xs text-muted">
            {projectPreset &&
              `本项目：${projectPreset.format === 'scene' ? '场景短片' : '短剧'} ${durationLabel(projectPreset)} · ${projectPreset.aspectRatio} · ${projectPreset.resolution} · `}
            已提交生成请求 {run.submissions}/{projectPreset?.maxSubmissions ?? preset.maxSubmissions} · 不自动重复已成功的素材
          </p>
          {run.error && <pre className="whitespace-pre-wrap text-sm text-red-300">{run.error}</pre>}
          {uncertain && !running && (
            <label className="flex gap-2 text-sm text-amber-200">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              确认重试未确认结果的请求，可能重复计费
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {running ? (
              <>
                <button className={btn} onClick={() => void stopPipeline(projectId)}>
                  暂停制作
                </button>
                <button className={btn} onClick={() => void stopPipeline(projectId, true)}>
                  取消后续任务
                </button>
              </>
            ) : (
              <button
                className={btn}
                disabled={creating || issues.length > 0 || (uncertain && !ack)}
                onClick={() => void resume()}
              >
                {run.status === 'done' ? '检查变更并继续' : '继续制作 / 重试失败节点'}
              </button>
            )}
            <button
              className={btn}
              disabled={running || creating}
              onClick={() => {
                setText(prod!.novel?.text ?? prod!.chapters.map((c) => c.text).join('\n\n'))
                setEditing(!editing)
              }}
            >
              编辑小说定稿
            </button>
            <button
              className={btn}
              onClick={() =>
                triggerDownload(
                  new Blob([prod!.novel?.text ?? prod!.chapters.map((c) => c.text).join('\n\n')], {
                    type: 'text/plain;charset=utf-8',
                  }),
                  '小说.txt',
                )
              }
            >
              下载小说 TXT
            </button>
            <button
              className={btn}
              onClick={() =>
                navigator.clipboard
                  .writeText([run.stage, run.detail, run.error ?? ''].join('\n'))
                  .catch(() => setError('无法访问剪贴板，请选择错误文字复制'))
              }
            >
              复制诊断
            </button>
          </div>
        </div>
      )}
      {editing && (
        <div className="space-y-3">
          <textarea
            aria-label="小说定稿"
            className={field + ' min-h-64 w-full'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <p className="text-xs text-amber-200">
            保存新定稿会归档旧版本，并使角色、方案、分镜与成片失效。原素材文件保留。请重新审稿后继续制作。
          </p>
          <button
            className={btn}
            onClick={() =>
              void replaceSource(projectId, text)
                .then(() => setEditing(false))
                .catch((e) => setError(String(e)))
            }
          >
            保存新定稿并更新依赖
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="whitespace-pre-wrap text-sm text-red-300">
          {error}
        </p>
      )}
    </section>
  )
}

/** 背景音乐：选择文件、调音量、取消配乐。 */
function BgmPicker({
  bgm,
  disabled,
  onPick,
  onVolume,
  onClear,
}: {
  bgm?: ProductionPreset['bgm']
  disabled?: boolean
  onPick: (file: File) => void
  onVolume: (volume: number) => void
  onClear: () => void
}) {
  return (
    <div className="space-y-1">
      <span className="block text-xs text-muted">背景音乐</span>
      <span className="flex items-center gap-2">
        <label
          className={
            'cursor-pointer rounded-lg border border-border px-4 py-1.5 text-sm hover:border-accent' +
            (disabled ? ' pointer-events-none opacity-40' : '')
          }
        >
          {bgm ? `♪ ${bgm.name.slice(0, 14)}` : '选择音乐文件'}
          <input
            aria-label="选择背景音乐"
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg"
            className="hidden"
            disabled={disabled}
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) onPick(f)
            }}
          />
        </label>
        {bgm && (
          <>
            <input
              aria-label="配乐音量"
              type="range"
              min="0.05"
              max="0.6"
              step="0.01"
              value={bgm.volume}
              disabled={disabled}
              onChange={(e) => onVolume(Number(e.target.value))}
            />
            <button className="text-xs text-muted underline" disabled={disabled} onClick={onClear}>
              不用配乐
            </button>
          </>
        )}
      </span>
    </div>
  )
}
