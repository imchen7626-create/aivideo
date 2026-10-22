import JSZip from 'jszip'
import { db } from '@/core/storage/db'
import { buildJianyingPackage } from '@/core/export/jianying'
import type { Project } from '@/types/domain'
import { buildEditTimeline } from '@/core/composition/plan'
import { buildSrt } from '@/core/composition/subtitles'
import { renderCover } from '@/core/composition/captions'
import type { Production } from '@/core/pipeline/production'

/** 发布平台可直接粘贴的标题、简介与话题。 */
export function publishText(production: Production, project: Project): string {
  const plan = production.plan
  const p = plan?.publish
  const title = p?.title || plan?.title || project.title
  const tags = (p?.hashtags?.length ? p.hashtags : ['短剧', 'AI短剧']).map((t) => '#' + t).join(' ')
  return `${title}\n\n${p?.description || plan?.logline || ''}\n\n${tags}\n`
}

/** 首镜首帧 + 片头标题合成封面；运行环境不支持画布时返回 undefined。 */
export async function buildCover(project: Project): Promise<Blob | undefined> {
  try {
    const production = await db.productions.get(project.id)
    const first = (await db.storyboards.where('projectId').equals(project.id).sortBy('sequence'))[0]
    const image = first?.imageAssetId ? await db.assets.get(first.imageAssetId) : undefined
    if (!image || typeof OffscreenCanvas === 'undefined') return undefined
    const portrait = production?.preset?.aspectRatio !== '16:9'
    return await renderCover(image.blob, production?.plan?.title || project.title, portrait ? 1080 : 1920, portrait ? 1920 : 1080)
  } catch {
    return undefined
  }
}

export async function buildProductionPackage(project: Project, onProgress?: (percent: number) => void): Promise<Blob> {
  const production = await db.productions.get(project.id)
  if (!production?.plan || !production.promptsReady) throw new Error('请先完成方案与镜头 Prompt。')
  const [characters, shots, allAssets] = await Promise.all([
    db.characters.where('projectId').equals(project.id).toArray(),
    db.storyboards.where('projectId').equals(project.id).sortBy('sequence'),
    db.assets.where('projectId').equals(project.id).toArray(),
  ])
  const zip = await JSZip.loadAsync(await buildJianyingPackage(project))
  zip.file('chapters.json', JSON.stringify(production.chapters, null, 2))
  zip.file('characters.json', JSON.stringify(characters, null, 2))
  zip.file('plan-60s.json', JSON.stringify(production.plan, null, 2))
  zip.file('drama-plan.json', JSON.stringify(production.plan, null, 2))
  zip.file('小说.txt',production.novel?.text??production.chapters.map(c=>c.text).join('\n\n'))
  zip.file('source-version.json',JSON.stringify({sha256:production.sourceHash,selectedChapter:production.selectedId,novelSha256:production.novel?.hash,revisionNotes:production.novel?.revisionNotes,preset:production.preset},null,2))
  zip.file('分镜脚本.md',shots.map(s=>`## 镜头 ${s.sequence}\n\n原文：${s.direction?.sourceExcerpt??''}\n\n画面：${s.sceneText}\n\n导演设定：${JSON.stringify(s.direction??{})}\n\n首帧：${s.imagePrompt??''}\n\n运动：${s.videoPrompt??s.sceneText}\n\n声音：${s.narration??''}\n\n剪辑：${JSON.stringify(s.edit??{})}`).join('\n\n'))
  zip.file('prompts.json', JSON.stringify(shots, null, 2))
  zip.file('script.txt', production.chapters.find(c => c.id === production.selectedId)?.text ?? '')
  zip.file('prompts.md', shots.map(s => `## 镜头 ${s.sequence} · ${s.durationSec} 秒\n\n${s.sceneText}\n\n字幕：${s.narration}\n\n${s.imagePrompt}`).join('\n\n'))
  for (const c of characters) {
    const a = allAssets.find(a => a.id === c.referenceAssetId)
    if (a) zip.file(`characters/${c.id}.${a.mimeType.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'png'}`, a.blob)
  }
  for(const shot of shots){const audio=allAssets.find(a=>a.id===shot.audioAssetId);if(audio)zip.file(`audio/shot-${shot.sequence}.mp3`,audio.blob)}
  const timeline = buildEditTimeline(shots,production.preset)
  if (production.composition?.fingerprint !== timeline.fingerprint) throw new Error('成片尚未合成，或分镜已修改。请先完成剪辑合成。')
  const composed = allAssets.find(a => a.id === production.composition?.assetId)
  if (!composed) throw new Error('成片文件缺失，请重新合成。')
  zip.file('edit-timeline.json', JSON.stringify(timeline, null, 2))
  zip.file('composition-checks.json', JSON.stringify(production.composition, null, 2))
  if (composed) zip.file('final.mp4', composed.blob)
  zip.file('发布文案.txt', publishText(production, project))
  zip.file('字幕.srt', buildSrt(shots))
  const cover = await buildCover(project)
  if (cover) zip.file('封面.jpg', cover)
  zip.file('production-manifest.json', JSON.stringify({ product: 'AI 短剧生产台', version: 2, project, selectedChapter: production.selectedId, targetDurationSec: production.preset?.durationSec??60, plannedDurationSec: timeline.durationSec, shots: shots.length, completedVideos: shots.filter(s => s.videoAssetId).length, finalIncluded: Boolean(composed), exportedAt: new Date().toISOString() }, null, 2))
  zip.file('README.txt', `AI 短剧生产台 — ${composed ? '成片包（含 final.mp4）' : '视频生成包（尚无合成成片）'}\n\n包含原文、章节、角色卡、60 秒方案、镜头 Prompt、字幕及已生成素材。\n如需成片，请在生产台配置图像与视频模型，完成所有镜头生成后合成。\n字幕来自方案，视频模型返回的实际时长可能不同，请在剪辑时检查节奏。\nassets 中素材可按序导入剪映；此包不是剪映原生草稿。\n基于 Apache-2.0 开源项目 dramai：https://github.com/hyyyyyyz/dramai\n`)
  const blob = await zip.generateAsync({ type: 'blob' }, metadata => onProgress?.(metadata.percent))
  const latest = await db.productions.get(project.id)
  const current = buildEditTimeline(await db.storyboards.where('projectId').equals(project.id).toArray(),latest?.preset)
  if (latest?.composition?.assetId !== composed.id || current.fingerprint !== timeline.fingerprint) throw new Error('导出期间分镜或成片已变化，请重新导出。')
  return blob
}
