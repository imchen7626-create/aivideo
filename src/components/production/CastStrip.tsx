import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, flushLocalStore } from '@/core/storage/db'
import type { Character } from '@/types/domain'
import { QWEN_VOICES } from '@/core/pipeline/presets'

function Thumb({ character }: { character: Character }) {
  const asset = useLiveQuery(
    () => (character.referenceAssetId ? db.assets.get(character.referenceAssetId) : undefined),
    [character.referenceAssetId],
  )
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!asset) return setUrl('')
    const u = URL.createObjectURL(asset.blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [asset])
  return (
    <figure className="w-24 shrink-0 text-center">
      <div className="h-36 w-24 overflow-hidden rounded-lg border border-border bg-background">
        {url ? (
          <img src={url} alt={character.name + ' 定妆照'} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted">待定妆</div>
        )}
      </div>
      <figcaption className="mt-1 truncate text-xs">{character.name}</figcaption>
      <select
        aria-label={character.name + ' 配音音色'}
        className="mt-1 w-full truncate rounded border border-border bg-background px-1 py-0.5 text-[10px]"
        value={character.voice ?? ''}
        title="修改后，该角色未生成的台词使用新音色；已生成的台词点“检查变更并继续”会按新音色重配"
        onChange={(e) => void db.characters.update(character.id, { voice: e.target.value || undefined })}
      >
        <option value="">自动音色</option>
        {QWEN_VOICES.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
      </select>
      {character.referenceAssetId && (
        <button
          className="mt-1 text-[10px] text-muted underline hover:text-foreground"
          title="只清掉这张定妆照，角色和镜头里的登记都保留；点“检查变更并继续”时重新生成"
          onClick={() => void redraw(character)}
        >
          重新生成定妆照
        </button>
      )}
    </figure>
  )
}

async function redraw(character: Character) {
  if (
    !window.confirm(
      `重新生成「${character.name}」的定妆照？\n\n只清掉当前这张，角色和镜头里的登记都保留。点“检查变更并继续”时会按新提示词重新生成（计 1 次出图请求）。\n已经生成的首帧和视频不会自动重做；需要的话在“分镜与镜头”里逐镜点“重新生成首帧”。`,
    )
  )
    return
  await db.characters.update(character.id, { referenceAssetId: undefined, locked: false })
  await flushLocalStore()
}

/** 主要角色的定妆照：每镜首帧都按这些参考图出图。 */
export function CastStrip({ projectId }: { projectId: string }) {
  const chars = useLiveQuery(
    () => db.characters.where('projectId').equals(projectId).toArray(),
    [projectId],
    [],
  )
  const main = chars.filter((c) => c.role !== 'extra')
  if (!main.length) return null
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted">角色定妆照与配音音色 · 每镜按此保持长相、服装和声音一致</span>
        <Link className="text-accent text-xs" to={`/projects/${projectId}/characters`}>
          不满意？上传或更换 →
        </Link>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {main.map((c) => (
          <Thumb key={c.id} character={c} />
        ))}
      </div>
    </div>
  )
}
