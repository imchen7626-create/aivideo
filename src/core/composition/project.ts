import { db, flushLocalStore } from '@/core/storage/db'
import { buildEditTimeline } from './plan'
import { concatVideos, type ConcatProgress } from './concat'
import type { CompositionRecord } from '@/core/pipeline/production'
import {reviewStoryboard} from './review'
import { captionLineChars, renderOverlayPng, splitCaption } from './captions'
const active = new Set<string>()

export async function composeProject(projectId:string,onProgress:(progress:ConcatProgress)=>void,signal?:AbortSignal):Promise<CompositionRecord>{
  if(active.has(projectId))throw new Error('本项目正在合成，请等待当前任务结束。')
  active.add(projectId)
  const setRun=async(status:'running'|'done'|'failed',error?:string)=>{
    const row=await db.productions.get(projectId)
    if(row)await db.productions.update(projectId,{nodeRuns:{...row.nodeRuns,compose:{status,error,updatedAt:Date.now()}}})
  }
  try{
    if(!await db.productions.get(projectId))await db.productions.put({projectId,chapters:[],selectedId:''})
    await setRun('running')
    const shots=await db.storyboards.where('projectId').equals(projectId).toArray()
    const production=await db.productions.get(projectId)
    const timeline=buildEditTimeline(shots,production?.preset)
    const inputs=[]
    for(const clip of timeline.clips){
      const asset=await db.assets.get(clip.assetId)
      if(!asset||asset.projectId!==projectId||!asset.blob.size)throw new Error(`镜头 ${clip.sequence} 素材文件缺失，请重新生成。`)
      const shot=shots.find(s=>s.id===clip.shotId)!
      const voiced=production?.preset?.audio==='narration'||production?.preset?.audio==='dialogue'
      // Lip-synced clips were animated to this exact voice file starting at frame 0: lay the same file
      // over the clip (its own soundtrack is replaced so model-side mixing cannot drift or double).
      const lip=!!shot.lipSynced
      const audio=voiced&&shot.audioAssetId?await db.assets.get(shot.audioAssetId):undefined
      if(voiced&&shot.narration?.trim()&&!audio)throw new Error(`镜头 ${clip.sequence} 配音缺失，请继续自动制作。`)
      const burn=production?.preset?.burnSubtitles===true&&!!clip.narration.trim()
      const titleText=production?.preset?.titleCard===true&&clip===timeline.clips[0]?(production?.plan?.title||(await db.projects.get(projectId))?.title||'').trim():''
      // A lip-synced clip carries only the voice: borrow the nearest same-scene clip's ambience.
      const roomClip=lip&&production?.preset?.audio==='dialogue'?timeline.clips.filter(c=>c.sceneId===clip.sceneId&&!shots.find(s=>s.id===c.shotId)?.lipSynced).sort((a,b)=>Math.abs(a.sequence-clip.sequence)-Math.abs(b.sequence-clip.sequence))[0]:undefined
      const roomTone=roomClip?(await db.assets.get(roomClip.assetId))?.blob:undefined
      inputs.push({blob:asset.blob,name:`镜头 ${clip.sequence}`,roomTone,trimInSec:clip.trimInSec,durationSec:clip.durationSec,muted:production?.preset?.audio==='narration'||lip||clip.muted,audioBlob:clip.muted?undefined:audio?.blob,ambientBed:production?.preset?.audio==='dialogue'&&!lip,
        captions:burn?splitCaption(clip.narration,captionLineChars(timeline.width,timeline.height)):undefined,
        title:titleText?{text:titleText.slice(0,18),durationSec:2.8}:undefined,
        fadeIn:clip.fadeIn,fadeOut:clip.fadeOut,grade:!!production?.preset?.resolution})
    }
    const bgmAsset=production?.preset?.bgm?await db.assets.get(production.preset.bgm.assetId):undefined
    const bgm=bgmAsset?{blob:bgmAsset.blob,volume:production!.preset!.bgm!.volume}:undefined
    const sourceInfo:{hasAudio:boolean}[]=[]
    const blob=await concatVideos(inputs,{fps:timeline.fps,outputWidth:timeline.width,outputHeight:timeline.height,onProgress,signal,bgm,onInputChecked:info=>sourceInfo.push(info),renderOverlay:inputs.some(i=>i.captions?.length||i.title)?renderOverlayPng:undefined})
    if(signal?.aborted)throw new DOMException('合成已中止','AbortError')
    const id=`composed-${crypto.randomUUID()}`
    const result:CompositionRecord={assetId:id,fingerprint:timeline.fingerprint,completedAt:Date.now(),durationSec:timeline.durationSec,shotCount:timeline.clips.length,timeline,checks:['所有镜头素材齐全','按分镜入出点与顺序裁剪',`画幅${timeline.width}×${timeline.height}、25fps`,'音轨AAC双声道48kHz，统一响度与峰值，接缝淡入淡出',production?.preset?.audio==='dialogue'?'角色分别配音，原声压低作环境声，语音超长自动微调语速':production?.preset?.audio==='narration'?'逐镜旁白替换原声，语音超长阻止截断':'保留可用原声，无声片补静音','成片时长与音视频轨道校验通过',...(production?.preset?.burnSubtitles===true?['字幕已烧录进画面（发布平台不会丢字幕）']:[]),...(production?.preset?.titleCard===true?['片头标题已叠加']:[]),...(bgm?['背景音乐随对白自动压低，片尾淡出']:[]),...(shots.some(s=>s.lipSynced)?[`${shots.filter(s=>s.lipSynced).length} 镜口型同步`]:[])]}
    result.reviewWarnings=reviewStoryboard(shots)
    const audioCount=sourceInfo.filter(s=>s.hasAudio).length
    result.checks.push(`原始素材音轨：${audioCount}/${sourceInfo.length}镜有音轨`)
    if(!audioCount&&production?.preset?.audio!=='narration'&&production?.preset?.audio!=='dialogue')result.reviewWarnings.unshift('原始视频均无音轨，当前保留原声模式仅补静音。如需旁白，请配置语音服务并切换后期旁白模式。')
    await db.transaction('rw',[db.storyboards,db.assets,db.productions],async()=>{
      const current=buildEditTimeline(await db.storyboards.where('projectId').equals(projectId).toArray(),(await db.productions.get(projectId))?.preset)
      if(current.fingerprint!==timeline.fingerprint)throw new Error('合成期间分镜或素材已变更，请按新版本重新合成。')
      const prod=await db.productions.get(projectId)
      await db.assets.add({id,projectId,kind:'video',mimeType:'video/mp4',blob,createdAt:Date.now()})
      if(prod)await db.productions.update(projectId,{composition:result,exportedAt:undefined,packageAssetId:undefined,nodeRuns:{...prod.nodeRuns,compose:{status:'done',updatedAt:Date.now()}}})
    })
    await flushLocalStore()
    return result
  }catch(error){await setRun('failed',error instanceof Error?error.message:String(error));await flushLocalStore();throw error}
  finally{active.delete(projectId)}
}
