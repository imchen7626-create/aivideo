import { getEditedDuration } from '@/core/composition/plan'
import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Image as ImageIcon, Trash2, Video } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Disclosure } from '@/components/ui/disclosure'
import { ShotImageButton } from '@/components/storyboard/ShotImageButton'
import { ShotVideoButton } from '@/components/storyboard/ShotVideoButton'
import { CameraMovementSelect } from '@/components/storyboard/CameraMovementSelect'
import { db, flushLocalStore } from '@/core/storage/db'
import { deleteStoryboard, updateStoryboard } from '@/core/storage/storyboards'
import { getObjectURL, releaseObjectURL } from '@/core/storage/assets'
import type { Asset, Character, Storyboard } from '@/types/domain'

interface Props {
  projectId: string
  /** 成片画幅，缩略图按同样的比例显示。 */
  aspectRatio?: '9:16' | '16:9'
}

const STATUS_LABEL: Record<Storyboard['status'], string> = {
  pending: '待生图',
  'image-ready': '图已生成',
  'video-ready': '视频已生成',
  failed: '失败',
}

export function StoryboardList({ projectId, aspectRatio = '9:16' }: Props) {
  const [editError, setEditError] = useState('')
  const shots = useLiveQuery<Storyboard[], Storyboard[]>(
    async () =>
      db.storyboards
        .where('[projectId+sequence]')
        .between([projectId, -Infinity], [projectId, Infinity], true, true)
        .toArray(),
    [projectId],
    [],
  )

  const characters = useLiveQuery<Character[], Character[]>(
    async () => db.characters.where('projectId').equals(projectId).toArray(),
    [projectId],
    [],
  )
  const characterById = useMemo(() => {
    const m = new Map<string, Character>()
    for (const c of characters) m.set(c.id, c)
    return m
  }, [characters])

  // 拉每个 shot 的 image / video assets 用于预览
  const assetIds = useMemo(() => {
    const ids: string[] = []
    for (const s of shots) {
      if (s.imageAssetId) ids.push(s.imageAssetId)
      if (s.videoAssetId) ids.push(s.videoAssetId)
    }
    return ids
  }, [shots])
  const assets = useLiveQuery<Asset[], Asset[]>(
    async () => (assetIds.length === 0 ? [] : db.assets.where('id').anyOf(assetIds).toArray()),
    [assetIds.join(',')],
    [],
  )
  const assetById = useMemo(() => {
    const m = new Map<string, Asset>()
    for (const a of assets) m.set(a.id, a)
    return m
  }, [assets])

  useEffect(() => {
    const ids = assets.map((a) => a.id)
    return () => {
      for (const id of ids) releaseObjectURL(id)
    }
  }, [assets])

  if (shots.length === 0) {
    return <p className="text-sm text-muted">还没有分镜。在上方写下指令，点「生成分镜」即可。</p>
  }

  return (
    <ol className="flex flex-col gap-3">
      {shots.map((s) => {
        const imageAsset = s.imageAssetId ? assetById.get(s.imageAssetId) : undefined
        const videoAsset = s.videoAssetId ? assetById.get(s.videoAssetId) : undefined
        const imageUrl = imageAsset ? getObjectURL(imageAsset) : undefined
        const videoUrl = videoAsset ? getObjectURL(videoAsset) : undefined

        return (
          <li
            key={s.id}
            className="flex flex-col gap-4 rounded-xl border border-border bg-background p-4 sm:flex-row"
          >
            <div
              className={
                'relative shrink-0 self-start overflow-hidden rounded-lg bg-black ' +
                (aspectRatio === '16:9' ? 'aspect-video w-full sm:w-64' : 'aspect-[9/16] w-32 sm:w-36')
              }
            >
              {videoUrl ? (
                <video
                  src={videoUrl}
                  controls
                  preload="metadata"
                  poster={imageUrl}
                  className="absolute inset-0 h-full w-full object-contain"
                />
              ) : imageUrl ? (
                <img
                  src={imageUrl}
                  alt={`分镜 ${s.sequence}`}
                  className="absolute inset-0 h-full w-full object-contain"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted">
                  <ImageIcon className="h-8 w-8" />
                </div>
              )}
              {videoUrl && (
                <span className="absolute right-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  <Video className="mr-0.5 inline h-3 w-3" />
                  视频
                </span>
              )}
            </div>

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted">
                  #{String(s.sequence).padStart(2, '0')}
                </span>
                <Badge variant="muted">{STATUS_LABEL[s.status]}</Badge>
                {s.durationSec && (
                  <span className="text-xs text-muted">
                    {s.sceneId ? `${s.sceneId} · ` : ''}
                    {s.continuity === 'continuous' ? '接上一镜尾帧 · ' : ''}
                    成片 {getEditedDuration(s).toFixed(2)}s · 素材 {s.durationSec}s
                  </span>
                )}
                {s.characterIds.map((cid) => {
                  const c = characterById.get(cid)
                  if (!c) return null
                  return (
                    <Badge key={cid} variant="accent" className="gap-1">
                      {c.locked ? '🔒' : '·'} {c.name}
                    </Badge>
                  )
                })}
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted hover:text-destructive"
                    onClick={() => {
                      if (window.confirm(`删除分镜 #${s.sequence}？`)) {
                        void deleteStoryboard(s.id)
                      }
                    }}
                    aria-label="删除分镜"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-foreground">{s.sceneText}</p>
              {s.narration && (
                <p className="mt-2 text-sm text-muted">
                  <span className="text-foreground/80">{s.speaker || '旁白'}：</span>
                  {s.narration}
                </p>
              )}
              {s.imagePrompt && (
                <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted" title={s.imagePrompt}>
                  <span className="text-accent">首帧 · </span>
                  {s.imagePrompt}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <CameraMovementSelect shot={s} />
                <ShotImageButton shot={s} />
                <ShotVideoButton shot={s} />
              </div>
              <Disclosure summary="编辑本镜画面、运动与台词" className="mt-3 border-t border-border pt-3">
                <form
                  className="space-y-3 text-sm"
                  key={JSON.stringify([s.sceneText, s.imagePrompt, s.videoPrompt, s.narration, s.speaker, s.delivery])}
                  onSubmit={(e) => {
                    e.preventDefault()
                    const data = new FormData(e.currentTarget)
                    void updateStoryboard(s.id, {
                      sceneText: String(data.get('scene')),
                      imagePrompt: String(data.get('image')),
                      videoPrompt: String(data.get('motion')),
                      narration: String(data.get('narration')),
                      speaker: String(data.get('speaker') ?? '').trim() || undefined,
                      delivery: String(data.get('delivery') ?? '').trim() || undefined,
                    })
                      .then(() => flushLocalStore())
                      .then(() => setEditError(''))
                      .catch((err) => setEditError(String(err)))
                  }}
                >
                  <p className="text-xs text-muted">
                    修改画面会使本镜图片和视频失效；仅修改动作只重做视频，仅修改旁白只重做配音。暂停后再修改，然后继续制作。
                  </p>
                  {(
                    [
                      ['scene', '画面与动作', s.sceneText],
                      ['image', '静态首帧 Prompt', s.imagePrompt],
                      ['motion', '视频运动 Prompt', s.videoPrompt],
                      ['speaker', '说话人（角色名 / 内心 / 旁白）', s.speaker],
                      ['narration', '台词', s.narration],
                      ['delivery', '表演指示（情绪、语气、语速）', s.delivery],
                    ] as const
                  ).map(([name, label, value]) => (
                    <label key={name} className="block text-xs text-muted">
                      {label}
                      <textarea
                        name={name}
                        defaultValue={value ?? ''}
                        className="mt-1 w-full rounded-lg border border-border bg-background-soft p-2 text-sm text-foreground"
                        rows={name === 'speaker' ? 1 : 3}
                      />
                    </label>
                  ))}
                  <p className="text-xs text-muted">
                    {s.direction?.framing} · {s.direction?.eyeline} · {s.direction?.purpose}
                  </p>
                  <Button type="submit" size="sm">
                    保存本镜修改
                  </Button>
                  {editError && (
                    <p role="alert" className="text-red-300">
                      {editError}
                    </p>
                  )}
                </form>
              </Disclosure>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
