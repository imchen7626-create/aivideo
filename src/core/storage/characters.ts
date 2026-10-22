import { nanoid } from 'nanoid'
import { db } from '@/core/storage/db'
import type { Character, CharacterRole } from '@/types/domain'

export interface CreateCharacterInput {
  projectId: string
  name: string
  description?: string
  role: CharacterRole
  referenceAssetId?: string
  locked?: boolean
  gender?: string
  age?: string
  voice?: string
}

export async function createCharacter(input: CreateCharacterInput): Promise<Character> {
  const character: Character = {
    id: nanoid(12),
    projectId: input.projectId,
    name: input.name.trim() || '未命名角色',
    description: input.description?.trim() || undefined,
    role: input.role,
    referenceAssetId: input.referenceAssetId,
    locked: input.locked ?? false,
    gender: input.gender,
    age: input.age,
    voice: input.voice,
    createdAt: Date.now(),
  }
  await db.characters.add(character)
  return character
}

export async function updateCharacter(
  id: string,
  patch: Partial<Omit<Character, 'id' | 'projectId' | 'createdAt'>>,
): Promise<void> {
  await db.characters.update(id, patch)
}

/** 删除角色：清掉它绑定的参考图 asset，并把所有引用它的 storyboard.characterIds 解除。 */
export async function deleteCharacter(id: string): Promise<void> {
  await db.transaction('rw', [db.characters, db.assets, db.storyboards], async () => {
    const c = await db.characters.get(id)
    if (!c) return
    // Reference images may also be used as shot first frames; retain shared media.
    const linkedShots = await db.storyboards.filter((s) => s.characterIds.includes(id)).toArray()
    for (const shot of linkedShots) {
      await db.storyboards.update(shot.id, {
        characterIds: shot.characterIds.filter((cid) => cid !== id),
      })
    }
    await db.characters.delete(id)
  })
}

export async function listProjectCharacters(projectId: string): Promise<Character[]> {
  return db.characters.where('projectId').equals(projectId).toArray()
}
