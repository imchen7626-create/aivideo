import { db, flushLocalStore } from '@/core/storage/db'
import { useSettingsStore } from '@/store/settings'
import { parseFile } from '@/core/parsers'
import { saveMaterial } from '@/core/storage/materials'
import { createProject } from '@/core/storage/projects'
import { splitChapters } from './chapters'
import { newAutomation } from './runner'
import { readPreset, resolveProviders, preflight, resolveAudio } from './presets'
export async function ingestNovel(file: File, chosen = readPreset()): Promise<string> {
  const settings = useSettingsStore.getState(),
    providers = resolveProviders(chosen, settings.providers, settings.activeProviderIds),
    preset = resolveAudio(chosen, providers)
  if (preset.mode === 'automatic') {
    const errors = preflight(preset, providers)
    if (errors.length) throw new Error(errors.join('；'))
  }
  const parsed = await parseFile(file),
    chapters = splitChapters(parsed.text)
  if (!chapters.length) throw new Error('文件没有可读正文')
  if (chapters.some((c) => c.text.length > 30000)) throw new Error('单章超过30,000字，请先拆分章节')
  const project = await createProject({
    title: file.name.replace(/\.[^.]+$/, ''),
    style: preset.style,
  })
  await saveMaterial(project.id, parsed)
  await db.productions.put({
    projectId: project.id,
    chapters,
    selectedId: chapters[0].id,
    preset,
    autoCompose: false,
    automation: {
      ...newAutomation(),
      status: preset.mode === 'automatic' ? 'queued' : 'paused',
      detail:
        preset.mode === 'automatic'
          ? '上传完成，将自动制作第一章'
          : '专业模式：可选择章节并逐步制作',
    },
  })
  await flushLocalStore()
  return project.id
}
