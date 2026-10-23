import { useState, useRef, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, flushLocalStore, storageMode } from '@/core/storage/db'
import { AutomationPanel } from '@/components/production/AutomationPanel'
import { ingestNovel } from '@/core/pipeline/ingest'
import { splitChapters } from '@/core/pipeline/chapters'
import {
  generateCharacters,
  generatePlan,
  generatePrompts,
  type NodeId,
  type NodeRun,
} from '@/core/pipeline/production'
import { useProjectProvider } from '@/core/pipeline/use-project-provider'
import { buildProductionPackage } from '@/core/export/production'
import { triggerDownload } from '@/core/export/json'
import { BatchImageButton } from '@/components/storyboard/BatchImageButton'
import { BatchVideoButton } from '@/components/storyboard/BatchVideoButton'
import { StoryboardList } from '@/components/storyboard/StoryboardList'
import { CompositionCard } from '@/components/composition/CompositionCard'
import {
  TaskProgress,
  type ProductionTask,
  type ProgressReporter,
} from '@/components/production/TaskProgress'
import { WorkflowNode, type NodeState } from '@/components/production/WorkflowNode'
import { getProviderCapabilityError } from '@/core/provider-capabilities'
import { buildEditTimeline, getEditedDuration } from '@/core/composition/plan'
import { directPlan, directShots } from '@/core/pipeline/directing'
import { APP_VERSION } from '@/version'
import { PanelCard, StudioPanel } from '@/components/production/StudioPanel'
const NODE_KEYS: NodeId[] = ['upload', 'parse', 'characters', 'plan', 'prompts', 'video', 'compose', 'export']
const actionNodes: Record<string, NodeId> = {
  上传脚本: 'upload',
  解析章节: 'parse',
  生成角色卡: 'characters',
  '生成 60 秒方案': 'plan',
  '生成镜头 Prompt': 'prompts',
  导出: 'export',
}
async function saveNodeRun(
  projectId: string,
  node: NodeId,
  status: NodeRun['status'],
  error?: string,
) {
  await db.transaction('rw', db.productions, async () => {
    const row = await db.productions.get(projectId)
    if (row)
      await db.productions.update(projectId, {
        nodeRuns: { ...row.nodeRuns, [node]: { status, error, updatedAt: Date.now() } },
      })
  })
}
export function StudioPage() {
  const [compositionBusy, setCompositionBusy] = useState(false)
  const [automationBusy, setAutomationBusy] = useState(false)
  const [id, setId] = useState(localStorage.getItem('studio-project') || '')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [task, setTask] = useState<ProductionTask | null>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const projects = useLiveQuery(() => db.projects.toArray(), [], [])
  const project = useLiveQuery(() => db.projects.get(id), [id])
  const materials = useLiveQuery(
    () => db.materials.where('projectId').equals(id).toArray(),
    [id],
    [],
  )
  const chars = useLiveQuery(() => db.characters.where('projectId').equals(id).toArray(), [id], [])
  const prod = useLiveQuery(() => db.productions.get(id), [id])
  const llm = useProjectProvider('llm', id)
  const imageProvider = useProjectProvider('text2image', id)
  const videoProvider = useProjectProvider('image2video', id)
  const mediaErrors = [imageProvider, videoProvider]
    .filter((p) => !!p)
    .map((p) => getProviderCapabilityError(p!))
    .filter(Boolean)
  const shots = useLiveQuery(() => db.storyboards.where('projectId').equals(id).toArray(), [id], [])
  const correctedChapters = useMemo(
    () => splitChapters(materials.map((m) => m.text).join('\n')),
    [materials],
  )
  useEffect(() => {
    if (
      busy ||
      !prod ||
      prod.automation ||
      prod.plan ||
      prod.promptsReady ||
      chars.length ||
      !correctedChapters.length ||
      JSON.stringify(prod.chapters) === JSON.stringify(correctedChapters)
    )
      return
    const previousTitle = prod.chapters.find((c) => c.id === prod.selectedId)?.title
    const selectedId =
      correctedChapters.find((c) => c.title === previousTitle)?.id ?? correctedChapters[0].id
    void db.productions
      .update(id, { chapters: correctedChapters, selectedId })
      .then(() => flushLocalStore())
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [busy, prod, chars.length, correctedChapters, id])
  const chapter = prod?.chapters.find((c) => c.id === prod.selectedId)
  const select = (v: string) => {
    setId(v)
    localStorage.setItem('studio-project', v)
    setError('')
    setTask((previous) => (previous?.status === 'running' ? previous : null))
  }
  const compositionAsset = useLiveQuery(
    () => (prod?.composition ? db.assets.get(prod.composition.assetId) : undefined),
    [prod?.composition?.assetId],
  )
  const compositionCurrent = useMemo(() => {
    try {
      return (
        !!compositionAsset &&
        prod?.composition?.fingerprint === buildEditTimeline(shots, prod?.preset).fingerprint
      )
    } catch {
      return false
    }
  }, [compositionAsset, prod?.composition, prod?.preset, shots])
  const professional = prod?.preset?.mode === 'professional'
  const completed: Record<NodeId, boolean> = {
    upload: materials.length > 0,
    parse: !!prod?.chapters.length,
    characters: chars.length > 0,
    plan: !!prod?.plan,
    prompts: !!prod?.promptsReady && shots.length > 0,
    video: shots.length > 0 && shots.every((s) => !!s.videoAssetId && !s.pendingVideoTask),
    compose: compositionCurrent,
    export: compositionCurrent && (!!prod?.exportedAt || !!prod?.packageAssetId),
  }
  function nodeState(node: NodeId): NodeState {
    if (
      prod?.automation?.status === 'running' &&
      automationBusy &&
      (({ casting: 'video', images: 'video', voice: 'compose', package: 'export' } as Record<string, string>)[
        prod.automation.stage
      ] ?? prod.automation.stage) === node
    )
      return 'running'
    if (
      prod?.automation?.status === 'failed' &&
      (({ casting: 'video', images: 'video', voice: 'compose', package: 'export' } as Record<string, string>)[
        prod.automation.stage
      ] ?? prod.automation.stage) === node
    )
      return 'failed'
    if (
      prod?.automation?.status === 'paused' &&
      (({ casting: 'video', images: 'video', voice: 'compose', package: 'export' } as Record<string, string>)[
        prod.automation.stage
      ] ?? prod.automation.stage) === node &&
      !completed[node]
    )
      return 'paused'
    if (node === 'compose' && compositionBusy) return 'running'
    if (busy && actionNodes[busy] === node) return 'running'
    if (task?.status === 'failed' && actionNodes[task.name] === node) return 'failed'
    if (node === 'video') {
      if (completed.video) return 'done'
      if (shots.some((s) => !!s.pendingVideoTask))
        return prod?.automation && !automationBusy
          ? prod.automation.status === 'running'
            ? 'interrupted'
            : 'paused'
          : 'running'
      if (shots.some((s) => s.status === 'failed')) return 'failed'
      if (shots.some((s) => !!s.videoAssetId)) return 'partial'
    }
    const saved = prod?.nodeRuns?.[node]
    if (saved?.status === 'failed') return 'failed'
    if (completed[node]) return 'done'
    if (node === 'compose' && prod?.composition) return 'partial'
    if (saved?.status === 'running') return 'interrupted'
    return 'pending'
  }
  const report: ProgressReporter = (event) =>
    setTask((previous) => (previous ? { ...previous, ...event } : previous))
  async function run(name: string, fn: (progress: ProgressReporter) => Promise<void>) {
    setBusy(name)
    setError('')
    setTask({
      name,
      kind: name.startsWith('生成') ? 'model' : 'local',
      phase: 'preparing',
      detail: '正在准备任务',
      startedAt: Date.now(),
      status: 'running',
    })
    requestAnimationFrame(() =>
      progressRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
    )
    try {
      const node = actionNodes[name]
      if (node) await saveNodeRun(id, node, 'running')
      await fn(report)
      if (node) await saveNodeRun(id, node, 'done')
      report({ phase: 'saving', detail: '正在将结果保存到本机' })
      await flushLocalStore()
      setTask((previous) =>
        previous
          ? {
              ...previous,
              status: 'done',
              finishedAt: Date.now(),
              detail: '任务已完成，结果已保存',
            }
          : previous,
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      const node = actionNodes[name]
      if (node)
        try {
          await saveNodeRun(id, node, 'failed', message)
          await flushLocalStore()
        } catch {
          /* Preserve the original error. */
        }
      setTask((previous) =>
        previous
          ? { ...previous, status: 'failed', finishedAt: Date.now(), detail: message }
          : previous,
      )
    } finally {
      setBusy('')
    }
  }
  const requireModel = () => {
    if (!llm) throw Error('请先在模型设置中配置并激活语言模型。')
    return llm
  }
  const btn =
    'rounded-lg border border-border bg-background-soft px-4 py-3 text-sm disabled:opacity-40 hover:border-accent'
  return (
    <div className="min-h-screen mx-auto max-w-7xl p-6 md:p-10">
      <header className="flex justify-between items-center border-b border-border pb-6">
        <div className="flex items-center gap-3">
          <strong className="text-xl">▣ AI 短剧生产台</strong>
          <span
            title="当前版本"
            className="rounded-full border border-border px-2 py-0.5 text-xs text-muted"
          >
            v{APP_VERSION}
          </span>
        </div>
        <Link to="/settings">模型设置 →</Link>
      </header>
      <section className={id ? 'py-4' : 'py-8'}>
        <p className="text-accent text-sm tracking-widest mb-3">ONE LINE TO SCREEN · 一句话成片</p>
        <h1 className={(id ? 'text-2xl' : 'text-4xl') + ' font-semibold mb-3'}>
          一句话，生成可以直接发布的短剧成片。
        </h1>
        <p className="text-muted">
          自动写故事、分镜、出图出视频、配旁白、烧字幕和标题、剪辑成片，并附上封面与发布文案。
        </p>
      </section>
      <div className="flex gap-4 mb-6">
        <select
          aria-label="当前项目"
          className={btn}
          value={id}
          disabled={!!busy || compositionBusy || automationBusy}
          onChange={(e) => select(e.target.value)}
        >
          <option value="">选择项目 / 上传新脚本</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
        <span className="text-muted self-center text-sm">项目保存在本机</span>
      </div>
      <AutomationPanel key={id} projectId={id} onSelect={select} onBusy={setAutomationBusy} />
      {prod?.promptsReady && mediaErrors.length > 0 && (
        <section
          role="alert"
          className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300"
        >
          {mediaErrors.map((message, i) => (
            <p key={i} className="mb-2">
              {message}
            </p>
          ))}
          <Link to="/settings" className="underline">
            修正文生图 / 图生视频配置 →
          </Link>
        </section>
      )}
      {storageMode === 'local-file' && (
        <p className="text-xs text-muted mb-4">
          已启用本地文件存储，兼容当前浏览器。项目与素材保存在本机 local-data 目录。
        </p>
      )}
      <div ref={progressRef}>{task && <TaskProgress task={task} />}</div>
      {error && (
        <p role="alert" className="p-4 text-red-400">
          {error} {/模型|LLM|API|HTTP|JSON/.test(error) && <Link to="/settings">打开模型设置</Link>}
        </p>
      )}
      {project && (
        <StudioPanel
          title="故事与方案"
          meta={[chapter?.title, `${chars.length} 个角色`, prod?.plan && `${prod.plan.beats.length} 个节拍`]
            .filter(Boolean)
            .join(' · ')}
          open={professional}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <PanelCard title="原文">
              {!materials.length ? (
                <p className="py-10 text-sm text-muted">
                  上传 TXT、Markdown 或 Word（DOCX），开始你的第一部短剧。
                </p>
              ) : (
                <>
                  <select
                    aria-label="选择章节"
                    className={btn + ' w-full mb-3'}
                    value={prod?.selectedId || ''}
                    disabled={
                      !!busy || compositionBusy || automationBusy || !!prod?.plan || !!chars.length
                    }
                    onChange={(e) =>
                      void run('切换章节', async () => {
                        await db.productions.update(id, { selectedId: e.target.value })
                      })
                    }
                  >
                    {prod?.chapters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-sm leading-7 text-muted">
                    {chapter?.text || materials.map((m) => m.text).join('\n')}
                  </pre>
                </>
              )}
            </PanelCard>
            <PanelCard
              title={`角色 · ${chars.length}`}
              action={
                <Link className="text-xs text-accent" to={`/projects/${id}/characters`}>
                  编辑角色与参考图 →
                </Link>
              }
            >
              {chars.map((c) => (
                <article key={c.id} className="mb-3 last:mb-0">
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="mt-1 text-sm text-muted">{c.description}</p>
                </article>
              ))}
              {!chars.length && (
                <p className="text-sm text-muted">解析章节后，提取人物与一致性视觉特征。</p>
              )}
            </PanelCard>
          </div>
          {prod?.plan && (
            <PanelCard title={`${prod.preset?.durationSec ?? 60} 秒方案 · ${prod.plan.logline}`}>
              <div className="grid gap-3 md:grid-cols-3">
                {prod.plan.beats.map((b, i) => (
                  <article key={i} className="rounded-lg bg-background-soft p-3">
                    <p className="text-sm font-medium">
                      {i + 1}. {b.title} · {b.durationSec}s
                    </p>
                    <p className="mt-2 text-sm text-muted">{b.description}</p>
                  </article>
                ))}
              </div>
            </PanelCard>
          )}
        </StudioPanel>
      )}
      {project && prod?.promptsReady && (
        <StudioPanel
          id="video-stage"
          title="分镜与镜头"
          meta={`${shots.length} 镜 · 成片 ${shots.reduce((sum, s) => sum + getEditedDuration(s), 0).toFixed(2)} 秒`}
          description="逐镜查看首帧、视频与提示词，可单独重做某一镜。请求由你的服务商计费；自动模式会接着完成剪辑和成片包。"
          open={professional}
        >
          <fieldset disabled={automationBusy || compositionBusy} className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <BatchImageButton projectId={id} />
              <BatchVideoButton projectId={id} />
            </div>
            <StoryboardList projectId={id} aspectRatio={prod.preset?.aspectRatio} />
          </fieldset>
        </StudioPanel>
      )}
      {project && prod?.promptsReady && (
        <CompositionCard key={id} project={project} onBusyChange={setCompositionBusy} />
      )}
      <StudioPanel
        title="逐步节点（专业模式）"
        meta={`${NODE_KEYS.filter((k) => nodeState(k) === 'done').length}/${NODE_KEYS.length} 已完成`}
        description="自动模式下无需操作；专业模式可以按顺序手动执行或重跑某一步。"
        open={professional}
      >
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <WorkflowNode
            number={1}
            title="上传脚本"
            state={nodeState('upload')}
            disabled={!!busy || compositionBusy || automationBusy}
          >
            <input
              className="hidden"
              type="file"
              accept=".txt,.md,.docx"
              disabled={!!busy || compositionBusy || automationBusy}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file)
                  void run('上传脚本', async () => {
                    select(await ingestNovel(file))
                  })
                e.target.value = ''
              }}
            />
          </WorkflowNode>
          <WorkflowNode
            number={2}
            title="解析章节"
            state={nodeState('parse')}
            disabled={!!busy || compositionBusy || automationBusy || !materials.length || !!prod}
            onClick={() =>
              void run('解析章节', async (progress) => {
                progress({ phase: 'generating', detail: '正在识别章节标题并拆分原文' })
                const chapters = splitChapters(materials.map((m) => m.text).join('\n'))
                progress({ phase: 'validating', detail: `已识别 ${chapters.length} 个章节` })
                if (!chapters.length) throw Error('没有可解析的章节')
                progress({ phase: 'persisting', detail: '正在保存章节列表' })
                await db.productions.put({ projectId: id, chapters, selectedId: chapters[0].id })
              })
            }
          />
          <WorkflowNode
            number={3}
            title="生成角色卡"
            state={nodeState('characters')}
            disabled={!!busy || compositionBusy || automationBusy || !chapter}
            onClick={() =>
              void run('生成角色卡', async (progress) => {
                await generateCharacters(requireModel(), id, chapter!, progress)
              })
            }
          />
          <WorkflowNode
            number={4}
            title={`生成 ${prod?.preset?.durationSec ?? 60} 秒短剧方案`}
            state={nodeState('plan')}
            disabled={
              !!busy ||
              compositionBusy ||
              automationBusy ||
              !chapter ||
              !chars.length ||
              !!prod?.promptsReady
            }
            onClick={() =>
              void run('生成 60 秒方案', async (progress) => {
                const plan = prod?.preset
                  ? await directPlan(
                      requireModel(),
                      chapter!,
                      project!,
                      chars,
                      prod.preset,
                      AbortSignal.timeout(300000),
                    )
                  : await generatePlan(requireModel(), chapter!, project!, chars, progress)
                progress({ phase: 'persisting', detail: '时长校验通过，正在保存剧情节拍' })
                await db.productions.put({ ...prod!, plan })
              })
            }
          />
          <WorkflowNode
            number={5}
            title="生成镜头 Prompt"
            state={nodeState('prompts')}
            disabled={
              !!busy || compositionBusy || automationBusy || !prod?.plan || !!prod?.promptsReady
            }
            onClick={() =>
              void run('生成镜头 Prompt', async (progress) => {
                if (prod?.preset) {
                  if (!videoProvider) throw new Error('请先配置视频模型，分镜需要匹配素材时长能力')
                  await directShots(
                    requireModel(),
                    videoProvider,
                    prod,
                    project!,
                    chars,
                    prod.preset,
                    AbortSignal.timeout(300000),
                  )
                } else await generatePrompts(requireModel(), prod!, project!, chars, progress)
              })
            }
          />
          <WorkflowNode
            number={6}
            title="提交视频生成"
            state={nodeState('video')}
            detail={
              shots.length
                ? `${shots.filter((s) => s.videoAssetId).length}/${shots.length} 个镜头已生成`
                : undefined
            }
            disabled={!prod?.promptsReady || !!busy || compositionBusy || automationBusy}
            onClick={() =>
              document.getElementById('video-stage')?.scrollIntoView({ behavior: 'smooth' })
            }
          />
          <WorkflowNode
            number={7}
            title="剪辑合成"
            state={nodeState('compose')}
            detail={
              compositionCurrent
                ? `${prod?.composition?.durationSec.toFixed(2)} 秒 · 已校验`
                : compositionBusy
                  ? '正在按分镜裁剪与拼接'
                  : '视频齐全后自动运行'
            }
            disabled={!completed.video}
            onClick={() =>
              document.getElementById('composition-stage')?.scrollIntoView({ behavior: 'smooth' })
            }
          />
          <WorkflowNode
            number={8}
            title="导出成片包"
            state={nodeState('export')}
            disabled={!!busy || compositionBusy || automationBusy || !compositionCurrent}
            onClick={() =>
              void run('导出', async (progress) => {
                progress({ phase: 'generating', detail: '正在收集素材并打包 ZIP' })
                const zip = await buildProductionPackage(project!, (percent) =>
                  progress({ phase: 'generating', detail: `ZIP 打包进度 ${Math.round(percent)}%` }),
                )
                progress({ phase: 'validating', detail: 'ZIP 打包完成' })
                progress({ phase: 'persisting', detail: '正在发起下载' })
                triggerDownload(zip, `AI短剧-${project!.title.replace(/[\\/:*?"<>|]/g, '-')}.zip`)
                await db.productions.update(id, { exportedAt: Date.now() })
              })
            }
          />
        </div>
      </StudioPanel>
      <footer className="text-xs text-muted mt-12 border-t border-border pt-5">
        基于 <a href="https://github.com/hyyyyyyz/dramai">dramai</a> · Apache-2.0 ·
        原文与产物保存在本机，生成时发送至你配置的模型服务。
      </footer>
    </div>
  )
}
