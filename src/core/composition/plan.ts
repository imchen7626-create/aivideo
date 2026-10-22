import type { Storyboard } from '@/types/domain'

export const EDIT_FPS = 25
export interface EditClip { shotId: string; sequence: number; assetId: string; trimInSec: number; trimOutSec: number; durationSec: number; timelineInSec: number; timelineOutSec: number; narration: string; cutNote: string; muted: boolean; sceneId?: string; continuity?: 'cut'|'continuous'; fadeIn?: boolean; fadeOut?: boolean }
export interface EditTimeline { fps: number; width:number; height:number; durationSec: number; clips: EditClip[]; warnings: string[]; fingerprint: string }

export const OUTPUT_SIZE: Record<string,[number,number]> = { '480P':[540,960], '720P':[720,1280], '1080P':[1080,1920] }
export function buildEditTimeline(shots: Storyboard[],options?:{aspectRatio?:string;audio?:string;burnSubtitles?:boolean;titleCard?:boolean;resolution?:string;bgm?:{assetId:string;volume:number}}): EditTimeline {
  if (!shots.length) throw new Error('没有分镜，请先生成镜头 Prompt。')
  const ordered = [...shots].sort((a,b)=>a.sequence-b.sequence)
  const seen = new Set<number>(), ids = new Set<string>()
  let frames = 0
  const warnings: string[] = []
  const clips: EditClip[] = ordered.map(s => {
    if (!Number.isInteger(s.sequence) || s.sequence < 1 || seen.has(s.sequence) || ids.has(s.id)) throw new Error('镜号重复或无效，请检查分镜顺序。')
    seen.add(s.sequence); ids.add(s.id)
    if (!s.videoAssetId || s.pendingVideoTask) throw new Error(`镜头 ${s.sequence} 视频尚未就绪，不会跳过缺片。`)
    const start=s.edit?.trimInSec ?? 0, end=s.edit?.trimOutSec ?? (s.durationSec ?? 5)
    if (!Number.isFinite(start) || !Number.isFinite(end) || start<0 || end<=start) throw new Error(`镜头 ${s.sequence} 的素材入点/出点无效。`)
    const startFrame=Math.round(start*EDIT_FPS), endFrame=Math.round(end*EDIT_FPS), durationFrames=endFrame-startFrame
    if (durationFrames<1 || end>600) throw new Error(`镜头 ${s.sequence} 裁剪范围无效。`)
    const durationSec=durationFrames/EDIT_FPS, timelineInSec=frames/EDIT_FPS
    frames+=durationFrames
    if (s.narration && s.narration.replace(/\s/g,'').length>durationSec*4) warnings.push(`镜头 ${s.sequence} 字幕较长，请试听语速并检查是否需要延长镜头。`)
    return {shotId:s.id,sequence:s.sequence,assetId:s.videoAssetId,trimInSec:startFrame/EDIT_FPS,trimOutSec:endFrame/EDIT_FPS,durationSec,timelineInSec,timelineOutSec:frames/EDIT_FPS,narration:s.narration??'',cutNote:s.edit?.cutNote??'直接切换；请核对相邻镜头的视线和动作。',muted:s.edit?.muted??false,sceneId:s.sceneId,continuity:s.continuity}
  })
  // Versioned deterministic input identity. Text/state changes also invalidate the review/export.
  // Scene changes get a short dip to black; cuts inside a scene stay hard cuts.
  if(options?.resolution)clips.forEach((c,i)=>{const prev=clips[i-1],next=clips[i+1];c.fadeIn=!!prev&&!!c.sceneId&&prev.sceneId!==c.sceneId;c.fadeOut=!!next&&!!c.sceneId&&next.sceneId!==c.sceneId})
  const [w,h]=OUTPUT_SIZE[options?.resolution??'720P']??OUTPUT_SIZE['720P']
  const width=options?.aspectRatio==='16:9'?h:w,height=options?.aspectRatio==='16:9'?w:h
  const overlay={...(options?.burnSubtitles===true||options?.titleCard===true?{overlay:{captions:options?.burnSubtitles===true,title:options?.titleCard===true}}:{}),...(options?.resolution?{look:{version:2,resolution:options.resolution}}:{}),...(options?.bgm?{bgm:[options.bgm.assetId,options.bgm.volume]}:{})}
  const fingerprint=JSON.stringify({version:3,fps:EDIT_FPS,width,height,clips,audio:options?.audio??'original',...overlay,story:ordered.map(s=>[s.sceneText,s.videoPrompt,s.edit?.entryState,s.edit?.exitState,options?.audio==='narration'||options?.audio==='dialogue'?(s.lipSynced?[s.audioAssetId,true]:s.audioAssetId):undefined])})
  return {fps:EDIT_FPS,width,height,durationSec:frames/EDIT_FPS,clips,warnings,fingerprint}
}

export function getEditedDuration(s: Storyboard): number {
  const a=s.edit?.trimInSec??0, b=s.edit?.trimOutSec??s.durationSec??5
  return Math.max(1,Math.round(b*EDIT_FPS)-Math.round(a*EDIT_FPS))/EDIT_FPS
}

/** Import only edit metadata; footage and source story are never replaced. */
export function readEditScript(raw: unknown, shots: Storyboard[], episodeIndex=0): { shotId:string; edit: NonNullable<Storyboard['edit']> }[] {
  if (!raw || typeof raw!=='object') throw new Error('需要分镜 JSON 对象。')
  const obj=raw as {shots?:unknown;episodes?:{shots?:unknown}[]}
  const entries=Array.isArray(obj.episodes)?obj.episodes[episodeIndex]?.shots:obj.shots
  if (!Array.isArray(entries) || entries.length!==shots.length) throw new Error(`导入分集必须与当前 ${shots.length} 个镜头逐一对应；不会删除或补造视频。`)
  const ordered=[...shots].sort((a,b)=>a.sequence-b.sequence)
  const seqs=new Set<number>()
  return entries.map((entry,i)=>{
    if(!entry || typeof entry!=='object')throw new Error('分镜条目无效。')
    const e=entry as Record<string,unknown>
    const sequence=e.sequence??i+1
    if(typeof sequence!=='number'||seqs.has(sequence)||!ordered.find(s=>s.sequence===sequence))throw new Error('导入镜号重复或与项目不匹配。')
    seqs.add(sequence)
    const shot=ordered.find(s=>s.sequence===sequence)!
    if(typeof e.trim_in!=='number'||typeof e.trim_out!=='number'||!Number.isFinite(e.trim_in)||!Number.isFinite(e.trim_out)||e.trim_in<0||e.trim_out<=e.trim_in)throw new Error(`镜头 ${sequence} 需要有效的 trim_in / trim_out。`)
    if(e.transition_overlap!==undefined&&e.transition_overlap!==0)throw new Error('当前按动作接点直接切换，不支持重叠转场时间线；请先将重叠转场改为直接切换。')
    return {shotId:shot.id,edit:{trimInSec:e.trim_in,trimOutSec:e.trim_out,cutNote:typeof e.cut_to_next==='string'?e.cut_to_next:undefined,entryState:typeof e.entry_state==='string'?e.entry_state:undefined,exitState:typeof e.exit_state==='string'?e.exit_state:undefined,...(shot.edit?.muted!==undefined?{muted:shot.edit.muted}:{})}}
  })
}
