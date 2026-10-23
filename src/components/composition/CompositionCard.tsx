import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Button } from '@/components/ui/button'
import { Disclosure } from '@/components/ui/disclosure'
import { StudioPanel } from '@/components/production/StudioPanel'
import { db, flushLocalStore } from '@/core/storage/db'
import { buildEditTimeline, getEditedDuration, readEditScript } from '@/core/composition/plan'
import { composeProject } from '@/core/composition/project'
import type { ConcatProgress } from '@/core/composition/concat'
import { buildSrt, buildVtt } from '@/core/composition/subtitles'
import { buildJianyingPackage } from '@/core/export/jianying'
import { triggerDownload } from '@/core/export/json'
import type { Project, Storyboard } from '@/types/domain'

export function CompositionCard({
  project,
  onBusyChange,
}: {
  project: Project
  onBusyChange?: (busy: boolean) => void
}) {
  const shots = useLiveQuery(
    () => db.storyboards.where('projectId').equals(project.id).sortBy('sequence'),
    [project.id],
    [],
  )
  const prod = useLiveQuery(() => db.productions.get(project.id), [project.id])
  const record = prod?.composition
  const asset = useLiveQuery(
    () => (record ? db.assets.get(record.assetId) : undefined),
    [record?.assetId],
  )
  const analysis = useMemo(() => {
    try {
      return { timeline: buildEditTimeline(shots, prod?.preset), error: '' }
    } catch (e) {
      return { timeline: undefined, error: e instanceof Error ? e.message : String(e) }
    }
  }, [shots, prod?.preset])
  const current =
    !!asset && !!analysis.timeline && record?.fingerprint === analysis.timeline.fingerprint
  const [composing, setComposing] = useState(false),
    [progress, setProgress] = useState<ConcatProgress | null>(null),
    [error, setError] = useState('')
  const [preview, setPreview] = useState(''),
    [script, setScript] = useState<{ raw: unknown; names: string[] } | null>(null),
    [episode, setEpisode] = useState(0)
  const [subtitleUrl, setSubtitleUrl] = useState('')
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([buildVtt(shots)], { type: 'text/vtt' }))
    setSubtitleUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [shots])
  const abortRef = useRef<AbortController | null>(null),
    attempted = useRef('')
  useEffect(() => {
    if (!current || !asset) {
      setPreview('')
      return
    }
    const url = URL.createObjectURL(asset.blob)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [current, asset])
  const compose = useCallback(async () => {
    const controller = new AbortController()
    abortRef.current = controller
    setComposing(true)
    onBusyChange?.(true)
    setError('')
    try {
      await composeProject(project.id, setProgress, controller.signal)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setComposing(false)
      abortRef.current = null
      onBusyChange?.(false)
    }
  }, [project.id, onBusyChange])
  useEffect(() => {
    const fingerprint = analysis.timeline?.fingerprint
    if (
      !fingerprint ||
      current ||
      composing ||
      !prod ||
      prod.automation ||
      prod.autoCompose === false ||
      prod.nodeRuns?.compose?.status === 'failed' ||
      attempted.current === fingerprint
    )
      return
    const timer = setTimeout(() => {
      attempted.current = fingerprint
      void compose()
    }, 800)
    return () => clearTimeout(timer)
  }, [
    analysis.timeline?.fingerprint,
    current,
    composing,
    prod?.autoCompose,
    prod?.nodeRuns?.compose?.status,
    !!prod,
    compose,
  ])
  const auto = prod?.autoCompose !== false
  const pipelineBusy =
    prod?.automation?.status === 'running' || prod?.automation?.status === 'queued'
  const packageAsset = useLiveQuery(
    () => (prod?.packageAssetId ? db.assets.get(prod.packageAssetId) : undefined),
    [prod?.packageAssetId],
  )
  async function setAuto(value: boolean) {
    try {
      await db.productions.update(project.id, { autoCompose: value })
      await flushLocalStore()
    } catch (e) {
      setError(String(e))
    }
  }
  async function stop() {
    await setAuto(false)
    abortRef.current?.abort()
  }
  async function updateEdit(shot: Storyboard, form: HTMLFormElement) {
    try {
      const data = new FormData(form),
        start = Number(data.get('start')),
        end = Number(data.get('end'))
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start)
        throw new Error('出点必须大于入点。')
      await db.storyboards.update(shot.id, {
        edit: {
          ...shot.edit,
          trimInSec: start,
          trimOutSec: end,
          cutNote: String(data.get('cut') ?? ''),
          muted: data.has('muted'),
        },
      })
      setError('')
      await flushLocalStore()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  async function importEdits() {
    try {
      if (!script) return
      const edits = readEditScript(script.raw, shots, episode)
      await db.transaction('rw', db.storyboards, async () => {
        for (const row of edits) await db.storyboards.update(row.shotId, { edit: row.edit })
      })
      await flushLocalStore()
      setError('')
      setScript(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const download = (blob: Blob, ext: string) =>
    triggerDownload(
      blob,
      `${project.title.replace(/[\\/:*?"<>|]/g, '-')}-${ext === 'mp4' ? '成片' : '字幕'}.${ext}`,
    )
  const percent = Math.round((progress?.ratio ?? 0) * 100)
  const labels: Record<ConcatProgress['phase'], string> = {
    waiting: '等待合成队列',
    loading: '加载本机视频处理核心',
    checking: '检查素材轨道与时长',
    transcoding: '按分镜裁剪并统一音视频',
    concatenating: '拼接完整时间线',
    validating: '检查成片时长与轨道',
    done: '视频处理完成，正在保存',
  }
  return (
    <StudioPanel
      id="composition-stage"
      title="成片 · 剪辑合成"
      meta={
        current
          ? `已完成 · ${record?.durationSec.toFixed(2)} 秒`
          : `已就绪 ${shots.filter((s) => s.videoAssetId && !s.pendingVideoTask).length}/${shots.length} 镜`
      }
      description="镜头齐全后按分镜自动剪辑。支持入出点、接点说明和独立字幕；旧版成片需要重新校验合成。"
      open
    >
        <div className="space-y-4 text-sm">
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={auto}
              disabled={composing || !prod}
              onChange={(e) => void setAuto(e.target.checked)}
            />
            镜头全部生成后自动剪辑合成
          </label>
          <p className="text-sm text-muted">
            已就绪 {shots.filter((s) => s.videoAssetId && !s.pendingVideoTask).length}/
            {shots.length} 镜 · 成片计划 {analysis.timeline?.durationSec.toFixed(2) ?? '—'} 秒 ·{' '}
            {analysis.timeline?.width ?? 720}×{analysis.timeline?.height ?? 1280} / 25fps
          </p>
          <div className="flex flex-wrap gap-2">
            {composing ? (
              <Button variant="destructive" onClick={() => void stop()}>
                中止合成
              </Button>
            ) : (
              <Button disabled={!analysis.timeline || pipelineBusy} onClick={() => void compose()}>
                {record ? '重新剪辑合成' : '开始剪辑合成'}
              </Button>
            )}
            <Button
              disabled={!current || composing}
              variant="secondary"
              onClick={() => asset && download(asset.blob, 'mp4')}
            >
              下载成片 mp4
            </Button>
            <Button
              disabled={!shots.length || composing}
              variant="secondary"
              onClick={() =>
                download(new Blob([buildSrt(shots)], { type: 'application/x-subrip' }), 'srt')
              }
            >
              导出 SRT
            </Button>
            <Button
              disabled={!shots.length || composing}
              variant="secondary"
              onClick={() => download(new Blob([buildVtt(shots)], { type: 'text/vtt' }), 'vtt')}
            >
              导出 VTT
            </Button>
            <Button
              disabled={composing || pipelineBusy}
              variant="secondary"
              onClick={() =>
                void buildJianyingPackage(project)
                  .then((blob) => triggerDownload(blob, `${project.title}-素材.zip`))
                  .catch((e) => setError(String(e)))
              }
            >
              下载剪辑素材 ZIP
            </Button>
            {packageAsset && current && (
              <Button
                variant="secondary"
                onClick={() => triggerDownload(packageAsset.blob, project.title + '-成片包.zip')}
              >
                下载已保存成片包
              </Button>
            )}
          </div>
          {composing && progress && (
            <div role="status" className="space-y-2 text-sm">
              <p>
                {labels[progress.phase]}
                {progress.totalClips
                  ? ` · ${progress.currentClip}/${progress.totalClips} 镜`
                  : ''}{' '}
                · {percent}%
              </p>
              <progress className="w-full" max={100} value={percent} />
            </div>
          )}
          {(error || prod?.nodeRuns?.compose?.status === 'failed') && (
            <p role="alert" className="rounded border border-red-500/50 p-3 text-red-300">
              {error || prod?.nodeRuns?.compose?.error}。自动重试已暂停，请检查后点击重新合成。
            </p>
          )}
          {!analysis.timeline && <p className="text-sm text-amber-300">{analysis.error}</p>}
          {record && !current && (
            <p className="text-sm text-amber-300">
              分镜、裁剪或素材已变更。旧成片已失效，重新合成后才能导出。
            </p>
          )}
          {current && (
            <div className="rounded border border-green-500/40 p-4">
              <p className="text-green-300">
                成片已完成并通过结构校验 · {record!.durationSec.toFixed(2)} 秒
              </p>
              <ul className="mt-2 list-inside list-disc text-xs text-muted">
                {record!.checks.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">
                请预览检查表演、口型、人物一致性和剪辑节奏。结构校验不替代观感检查。
              </p>
            </div>
          )}
          {current && !!record?.reviewWarnings?.length && (
            <Disclosure tone="warning" summary={`观感复核提醒 · ${record.reviewWarnings.length} 项`}>
              <ul className="list-inside list-disc text-xs text-muted">
                {record.reviewWarnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            </Disclosure>
          )}
          {preview && (
            <video
              className="mx-auto block max-h-[28rem] rounded-lg bg-black"
              src={preview}
              controls
              preload="metadata"
            >
              <track kind="subtitles" src={subtitleUrl} label="字幕" default={prod?.preset?.burnSubtitles !== true} />
            </video>
          )}
          <Disclosure summary="按分镜调整裁剪、声音与剪辑接点">
            <div className="space-y-4">
              <p className="text-xs text-muted">
                按镜号顺序直接切换，避免对白场景被过度叠化。先检查每对镜头的视线与动作，再调整素材入出点。声音保留原片段；可逐镜静音，短音频补静音尾，无声片自动补静音轨。不会凭空生成旁白或配乐。
              </p>
              {shots.map((s) => (
                <form
                  key={s.id + JSON.stringify(s.edit)}
                  className="rounded border border-border p-3 text-sm"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void updateEdit(s, e.currentTarget)
                  }}
                >
                  <p className="mb-2 font-medium">
                    #{s.sequence} · 计划 {getEditedDuration(s).toFixed(2)} 秒
                  </p>
                  <p className="mb-2 text-xs text-muted">{s.sceneText}</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <label>
                      素材入点（秒）
                      <input
                        className="ml-2 w-20 rounded border border-border p-1"
                        name="start"
                        type="number"
                        min="0"
                        step="0.04"
                        defaultValue={s.edit?.trimInSec ?? 0}
                        required
                        disabled={composing || pipelineBusy}
                      />
                    </label>
                    <label>
                      素材出点（秒）
                      <input
                        className="ml-2 w-20 rounded border border-border p-1"
                        name="end"
                        type="number"
                        min="0.04"
                        step="0.04"
                        defaultValue={s.edit?.trimOutSec ?? s.durationSec ?? 5}
                        required
                        disabled={composing || pipelineBusy}
                      />
                    </label>
                    <label className="flex gap-1">
                      <input
                        type="checkbox"
                        name="muted"
                        defaultChecked={s.edit?.muted}
                        disabled={composing || pipelineBusy}
                      />
                      本镜静音
                    </label>
                  </div>
                  <label className="mt-2 block">
                    切到下一镜的接点说明
                    <input
                      className="mt-1 w-full rounded border border-border p-2"
                      name="cut"
                      defaultValue={s.edit?.cutNote ?? ''}
                      placeholder="例如：在右手离开凭证时切到对方反应，保持左右位置"
                      disabled={composing || pipelineBusy}
                    />
                  </label>
                  <Button
                    type="submit"
                    size="sm"
                    className="mt-2"
                    disabled={composing || pipelineBusy}
                  >
                    保存本镜剪辑
                  </Button>
                </form>
              ))}
            </div>
          </Disclosure>
          <Disclosure summary="导入分镜脚本的剪辑 JSON">
            <div className="space-y-3 text-sm">
              <p>
                支持 shots 或制作清单中的 episodes。只更新逐镜 trim_in、trim_out
                和接点说明，不替换原视频。请选对应分集并核对镜数与画面，导入后自动合成会按新裁剪运行；可先关闭自动合成。
              </p>
              <input
                type="file"
                accept=".json"
                disabled={composing || pipelineBusy}
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  try {
                    const raw = JSON.parse(await f.text())
                    const names = Array.isArray(raw.episodes)
                      ? raw.episodes.map(
                          (ep: { title?: string }, i: number) => ep.title ?? `第${i + 1}集`,
                        )
                      : ['当前分镜']
                    setScript({ raw, names })
                    setEpisode(0)
                    setError('')
                  } catch {
                    setError('分镜 JSON 无法读取。')
                  }
                }}
              />
              {script && (
                <>
                  <select
                    aria-label="导入分集"
                    className="rounded border p-2"
                    value={episode}
                    onChange={(e) => setEpisode(Number(e.target.value))}
                  >
                    {script.names.map((name, i) => (
                      <option key={i} value={i}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <Button disabled={composing || pipelineBusy} onClick={() => void importEdits()}>
                    应用到当前镜头
                  </Button>
                </>
              )}
            </div>
          </Disclosure>
          {analysis.timeline?.warnings.map((w) => (
            <p key={w} className="text-xs text-amber-300">
              {w}
            </p>
          ))}
        </div>
    </StudioPanel>
  )
}
