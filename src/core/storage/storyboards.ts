import { nanoid } from 'nanoid'
import { db } from '@/core/storage/db'
import type { Character, Storyboard } from '@/types/domain'
import type { StoryboardDraft } from '@/core/prompts/storyboard'

/**
 * 把 LLM 输出的 StoryboardDraft 写进 IndexedDB。
 * 角色名字到 character.id 的映射在这里完成；不在 LLM 输出里出现的角色名直接忽略。
 */
export async function appendStoryboardFromDraft(
  projectId: string,
  draft: StoryboardDraft,
  characters: Character[],
): Promise<Storyboard> {
  const nameToId = new Map(characters.map((c) => [c.name, c.id]))
  const characterIds = (draft.character_names ?? [])
    .map((name) => nameToId.get(name))
    .filter((id): id is string => Boolean(id))

  const storyboard: Storyboard = {
    id: nanoid(12),
    projectId,
    sequence: Math.max(1, Math.floor(draft.sequence)),
    sceneText: draft.scene_text?.trim() ?? '',
    narration: draft.narration?.trim() || undefined,
    imagePrompt: draft.image_prompt?.trim() || undefined,
    edit: draft.edit,
    videoPrompt: draft.video_prompt,
    direction: draft.direction,
    sceneId: draft.scene_id,
    continuity: draft.continuity,
    shotSize: draft.shot_size,
    speaker: draft.speaker,
    delivery: draft.delivery,
    characterIds,
    durationSec:
      typeof draft.duration_sec === 'number' && draft.duration_sec > 0
        ? Math.round(draft.duration_sec)
        : undefined,
    status: 'pending',
  }
  await db.storyboards.add(storyboard)
  return storyboard
}

/**
 * 删除一个项目下所有分镜（重新生成前调用）。
 * 关联的图/视频 asset 一起删，避免悬空引用占空间。
 */
export async function clearProjectStoryboards(projectId: string): Promise<void> {
  await db.transaction('rw', [db.storyboards, db.assets], async () => {
    const list = await db.storyboards.where('projectId').equals(projectId).toArray()
    const assetIds: string[] = []
    for (const s of list) {
      if (s.imageAssetId) assetIds.push(s.imageAssetId)
      if (s.videoAssetId) assetIds.push(s.videoAssetId)
    }
    if (assetIds.length > 0) {
      await db.assets.where('id').anyOf(assetIds).delete()
    }
    await db.storyboards.where('projectId').equals(projectId).delete()
  })
}

export async function deleteStoryboard(id: string): Promise<void> {
  await db.transaction('rw', [db.storyboards, db.assets], async () => {
    const s = await db.storyboards.get(id)
    if (!s) return
    if (s.imageAssetId) await db.assets.delete(s.imageAssetId)
    if (s.videoAssetId) await db.assets.delete(s.videoAssetId)
    await db.storyboards.delete(id)
  })
}

export async function updateStoryboard(
  id: string,
  patch: Partial<Omit<Storyboard, 'id' | 'projectId'>>,
): Promise<void> {
  const previous=await db.storyboards.get(id)
  if(!previous)return
  if(patch.sceneText!==undefined&&!patch.sceneText.trim())throw new Error('画面与动作不能为空。')
  const visualChanged=(patch.imagePrompt!==undefined&&patch.imagePrompt.trim()!==(previous.imagePrompt??'').trim())||(patch.characterIds!==undefined&&JSON.stringify(patch.characterIds)!==JSON.stringify(previous.characterIds))
  const motionChanged=(patch.sceneText!==undefined&&patch.sceneText!==previous.sceneText)||(patch.videoPrompt!==undefined&&patch.videoPrompt.trim()!==(previous.videoPrompt??'').trim())
  if((visualChanged||motionChanged)&&previous.pendingVideoTask)throw new Error('此镜头有远端视频任务，请先完成查询再修改画面或运动提示词。')
  // Keep historical asset files; detach only the affected downstream references.
  if(visualChanged){patch.imageAssetId=undefined;patch.videoAssetId=undefined;patch.status='pending'}
  else if(motionChanged){patch.videoAssetId=undefined;patch.status=previous.imageAssetId?'image-ready':'pending'}
  if((patch.narration!==undefined&&patch.narration!==previous.narration)||(patch.speaker!==undefined&&patch.speaker!==previous.speaker)||(patch.delivery!==undefined&&patch.delivery!==previous.delivery)){patch.audioAssetId=undefined;patch.audioFingerprint=undefined
    // A lip-synced clip was animated to the old line: it has to be regenerated with the new one.
    if(previous.lipSynced){if(previous.pendingVideoTask)throw new Error('此镜头有远端视频任务，请先完成查询再修改台词。');patch.videoAssetId=undefined;patch.lipSynced=false;patch.status=previous.imageAssetId?'image-ready':'pending'}}
  await db.storyboards.update(id, patch)
}
