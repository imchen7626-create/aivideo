import { loadFFmpeg, resetFFmpeg } from '@/core/composition/ffmpeg'
import type { FFmpeg } from '@ffmpeg/ffmpeg'
import { timeCaptions, type OverlaySpec } from './captions'

export interface ConcatProgress {
  phase: 'waiting' | 'loading' | 'checking' | 'transcoding' | 'concatenating' | 'validating' | 'done'
  currentClip?: number
  totalClips?: number
  ratio?: number
  log?: string
}
export interface MediaInfo { durationSec:number; width:number; height:number; hasAudio:boolean }
export interface ConcatInput { blob:Blob; name:string; durationSec?:number; trimInSec?:number; muted?:boolean; audioBlob?:Blob; /** 烧录字幕片段（按顺序、按字数分配时间）。 */ captions?:string[]; /** 叠加在本镜开头的大标题。 */ title?:{text:string;durationSec:number}; /** 场次切换处的短暂黑场过渡。 */ fadeIn?:boolean; fadeOut?:boolean; /** 统一调色，让不同镜头的影调一致。 */ grade?:boolean; /** 配音时把视频原声压低垫在下面当环境声。 */ ambientBed?:boolean; /** 口型同步镜头的原声只有配音：借同场景另一镜的环境声循环垫底，台词说完不会突然死寂。 */ roomTone?:Blob }
export type OverlayRenderer=(spec:OverlaySpec)=>Promise<Blob>
/** 旁白最多自动加速到的倍率；更长的旁白需要精简文本或延长镜头。 */
export const MAX_VOICE_TEMPO=1.35
let queue:Promise<void> = Promise.resolve()

export function parseMediaInfo(log:string): MediaInfo {
  const duration=log.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  const video=log.match(/Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/)
  if(!duration||!video)throw new Error('素材没有可读取的视频轨道或时长，无法合成。')
  return {durationSec:Number(duration[1])*3600+Number(duration[2])*60+Number(duration[3]),width:Number(video[1]),height:Number(video[2]),hasAudio:/Audio:/.test(log)}
}

/** FFmpeg arguments for one normalized clip: scale/pad, PNG overlays, voice tempo and loudness. */
export const GRADE_FILTER='eq=contrast=1.05:saturation=0.94:gamma=0.98,unsharp=5:5:0.35:5:5:0'
export function clipArgs(o:{start:number;input:string;voiceFile?:string;overlays:{file:string;start:number;end:number}[];audioIn:string;tempo:number;duration:number;width:number;height:number;fps:number;output:string;fadeIn?:boolean;fadeOut?:boolean;grade?:boolean;bed?:boolean;ambientOnly?:boolean;roomFile?:string}):string[]{
  // Fill the frame (crop overflow) rather than letterboxing mismatched model output.
  const fit=o.grade?`scale=${o.width}:${o.height}:force_original_aspect_ratio=increase,crop=${o.width}:${o.height}`:`scale=${o.width}:${o.height}:force_original_aspect_ratio=decrease,pad=${o.width}:${o.height}:(ow-iw)/2:(oh-ih)/2:color=black`
  const fades=[o.fadeIn?'fade=t=in:st=0:d=0.25':'',o.fadeOut?`fade=t=out:st=${Math.max(0,o.duration-0.25).toFixed(3)}:d=0.25`:''].filter(Boolean)
  const base=[fit,'setsar=1',`fps=${o.fps}`,'setpts=PTS-STARTPTS',...(o.grade?[GRADE_FILTER]:[]),...fades].join(',')
  let graph=`[0:v]${base}[v0]`,last='v0'
  o.overlays.forEach((ov,k)=>{graph+=`;[${k+2}:v]format=rgba[o${k}];[${last}][o${k}]overlay=0:0:eof_action=repeat:enable='between(t,${ov.start.toFixed(3)},${ov.end.toFixed(3)})'[v${k+1}]`;last=`v${k+1}`})
  const tail=`afade=t=in:st=0:d=0.008,afade=t=out:st=${Math.max(0,o.duration-.008)}:d=0.008`
  const voice=`[${o.audioIn}]${o.tempo>1?`atempo=${o.tempo.toFixed(4)},`:''}aresample=48000:async=1:first_pts=0,loudnorm=I=-16:TP=-1.5:LRA=11,apad`
  // Ambient bed: the clip's own sound, ducked far under the dialogue, keeps the scene alive.
  // Borrowed room tone (looped input after the overlays) stands in when the clip's own sound is the voice.
  const bedIn=o.bed?'0:a':o.roomFile?`${2+o.overlays.length}:a`:''
  graph+=o.ambientOnly?`;[0:a]aresample=48000:async=1:first_pts=0,volume=0.16,apad,${tail}[aout]`:bedIn?`;${voice}[vo];[${bedIn}]aresample=48000:async=1:first_pts=0,volume=0.16,apad[bg];[vo][bg]amix=inputs=2:duration=first:normalize=0,${tail}[aout]`:`;${voice},${tail}[aout]`
  return ['-ss',String(o.start),'-i',o.input,...(o.voiceFile?['-i',o.voiceFile]:['-f','lavfi','-i','anullsrc=channel_layout=stereo:sample_rate=48000']),
    ...o.overlays.flatMap(ov=>['-i',ov.file]),
    ...(o.roomFile&&!o.bed?['-stream_loop','-1','-i',o.roomFile]:[]),
    '-filter_complex',graph,'-map',`[${last}]`,'-map','[aout]','-t',String(o.duration),
    '-c:v','libx264','-preset','ultrafast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-ar','48000','-ac','2','-map_metadata','-1',o.output]
}

/** 拼接整条时间线；有配乐时循环铺满、随对白自动压低（侧链压缩），片尾 2 秒淡出。 */
export function finalArgs(o:{total:number;fps:number;bgmFile?:string;bgmVolume:number;output:string}):string[]{
  const video=['-vf',`fps=${o.fps},setpts=PTS-STARTPTS`]
  const tail=['-c:v','libx264','-preset','ultrafast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-ar','48000','-ac','2','-movflags','+faststart',o.output]
  if(!o.bgmFile)return ['-f','concat','-safe','0','-i','concat.txt','-t',String(o.total),...video,'-af','aresample=48000:async=1:first_pts=0',...tail]
  const fadeAt=Math.max(0,o.total-2).toFixed(3)
  const graph=`[0:a]aresample=48000:async=1:first_pts=0,asplit=2[main][key];[1:a]aresample=48000,aformat=channel_layouts=stereo,volume=${o.bgmVolume.toFixed(3)},afade=t=in:st=0:d=1,afade=t=out:st=${fadeAt}:d=2[music];[music][key]sidechaincompress=threshold=0.03:ratio=6:attack=15:release=350[ducked];[main][ducked]amix=inputs=2:duration=first:normalize=0[aout]`
  return ['-f','concat','-safe','0','-i','concat.txt','-stream_loop','-1','-i',o.bgmFile,'-t',String(o.total),...video,'-filter_complex',graph,'-map','0:v:0','-map','[aout]',...tail]
}

export async function inspectMedia(ffmpeg:FFmpeg,file:string):Promise<MediaInfo>{
  const lines:string[]=[]
  const log=({message}:{message:string})=>{lines.push(message)}
  ffmpeg.on('log',log)
  try {
    // -i without an output intentionally returns nonzero and prints stream metadata.
    await ffmpeg.exec(['-hide_banner','-i',file])
    return parseMediaInfo(lines.join('\n'))
  } finally { ffmpeg.off('log',log) }
}

export async function concatVideos(inputs:ConcatInput[],options:{outputWidth?:number;outputHeight?:number;fps?:number;onProgress?:(p:ConcatProgress)=>void;onValidated?:(info:MediaInfo)=>void;onInputChecked?:(info:MediaInfo)=>void;renderOverlay?:OverlayRenderer;bgm?:{blob:Blob;volume:number};signal?:AbortSignal}={}):Promise<Blob>{
  const previous=queue
  let release!:()=>void
  queue=new Promise<void>(resolve=>{release=resolve})
  options.onProgress?.({phase:'waiting',ratio:0})
  await previous
  try { return await render(inputs,options) } finally {release()}
}

async function render(inputs:ConcatInput[],options:Parameters<typeof concatVideos>[1]):Promise<Blob>{
  const {outputWidth=720,outputHeight=1280,fps=25,onProgress:reportProgress,onValidated,signal}=options??{}
  let lastRatio=0
  const onProgress=(p:ConcatProgress)=>{lastRatio=Math.max(lastRatio,p.ratio??lastRatio);reportProgress?.({...p,ratio:lastRatio})}
  const checkAbort=()=>{if(signal?.aborted)throw new DOMException('合成已中止','AbortError')}
  checkAbort()
  if(!inputs.length)throw new Error('没有可拼接的视频')
  const durations=inputs.map(input=>{
    if(!input.blob?.size)throw new Error(`${input.name} 文件为空`)
    const duration=input.durationSec??5,start=input.trimInSec??0
    if(!Number.isFinite(duration)||duration<=0||!Number.isFinite(start)||start<0)throw new Error(`${input.name} 裁剪范围无效`)
    return Math.round(duration*fps)/fps
  })
  const total=durations.reduce((a,b)=>a+b,0)
  onProgress?.({phase:'loading',ratio:0})
  const ffmpeg=await loadFFmpeg()
  checkAbort()
  const files=new Set<string>()
  let phase:ConcatProgress['phase']='checking',currentClip=0
  const progress=({progress}:{progress:number})=>{
    const p=Math.max(0,Math.min(1,Number.isFinite(progress)?progress:0))
    const ratio=phase==='transcoding'?.05+.75*((currentClip-1+p)/inputs.length):phase==='concatenating'?.8+.15*p:.97
    if(phase==='transcoding'||phase==='concatenating')onProgress?.({phase,currentClip,totalClips:inputs.length,ratio})
  }
  const abort=()=>resetFFmpeg()
  signal?.addEventListener('abort',abort,{once:true})
  ffmpeg.on('progress',progress)
  const exec=async(args:string[])=>{checkAbort();const code=await ffmpeg.exec(['-y',...args]);checkAbort();if(code!==0)throw new Error(`视频处理失败（FFmpeg ${code}），请检查素材。`)}
  try {
    const {fetchFile}=await import('@ffmpeg/util')
    for(let i=0;i<inputs.length;i++){
      checkAbort();currentClip=i+1;phase='checking'
      onProgress?.({phase,currentClip,totalClips:inputs.length,ratio:.05+.75*i/inputs.length})
      const input=`in_${i}.bin`,mid=`mid_${i}.mp4`,duration=durations[i],start=inputs[i].trimInSec??0
      files.add(input);files.add(mid)
      await ffmpeg.writeFile(input,await fetchFile(inputs[i].blob))
      const info=await inspectMedia(ffmpeg,input)
      options?.onInputChecked?.(info)
      if(start+duration>info.durationSec+1/fps)throw new Error(`${inputs[i].name} 实际只有 ${info.durationSec.toFixed(2)} 秒，分镜需要裁剪到 ${(start+duration).toFixed(2)} 秒。请缩短出点或补生成；不会自动拉伸、定格凑时长。`)
      phase='transcoding'
      onProgress?.({phase,currentClip,totalClips:inputs.length,ratio:.05+.75*i/inputs.length})
      const voice=inputs[i].audioBlob,voiceFile=`voice_${i}.bin`
      let tempo=1,speechSec=duration
      if(voice){
        files.add(voiceFile);await ffmpeg.writeFile(voiceFile,await fetchFile(voice))
        const logs:string[]=[];const log=({message}:{message:string})=>logs.push(message);ffmpeg.on('log',log)
        try{await ffmpeg.exec(['-hide_banner','-i',voiceFile])}finally{ffmpeg.off('log',log)}
        const match=logs.join('\n').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
        if(!match||!logs.some(l=>l.includes('Audio:')))throw new Error(`${inputs[i].name} 配音不是有效音频`)
        const voiceDuration=Number(match[1])*3600+Number(match[2])*60+Number(match[3])
        const room=Math.max(.5,duration-.08)
        if(voiceDuration>room){
          tempo=voiceDuration/room
          if(tempo>MAX_VOICE_TEMPO)throw new Error(`${inputs[i].name} 旁白长${voiceDuration.toFixed(2)}秒，超过镜长${duration}秒（自动加速上限${MAX_VOICE_TEMPO}倍）。请精简旁白或延长镜头，不会截断对白。`)
        }
        speechSec=Math.min(duration,voiceDuration/tempo)
      }
      // Burned-in subtitles and the opening title are full-frame transparent PNG overlays.
      const overlays:{file:string;start:number;end:number}[]=[]
      if(options?.renderOverlay){
        const cues=timeCaptions(inputs[i].captions??[],voice?speechSec:duration,duration)
        for(const [k,cue] of cues.entries()){
          const file=`cap_${i}_${k}.png`;files.add(file)
          await ffmpeg.writeFile(file,await fetchFile(await options.renderOverlay({kind:'caption',text:cue.text,width:outputWidth,height:outputHeight})))
          overlays.push({file,start:cue.start,end:cue.end})
        }
        const title=inputs[i].title
        if(title?.text.trim()){
          const file=`title_${i}.png`;files.add(file)
          await ffmpeg.writeFile(file,await fetchFile(await options.renderOverlay({kind:'title',text:title.text,width:outputWidth,height:outputHeight})))
          overlays.push({file,start:0,end:Math.min(duration,title.durationSec)})
        }
      }
      const audioIn=voice?'1:a':info.hasAudio&&!inputs[i].muted?'0:a':'1:a'
      let roomFile:string|undefined
      if(voice&&inputs[i].roomTone){
        const file=`room_${i}.bin`;files.add(file);await ffmpeg.writeFile(file,await fetchFile(inputs[i].roomTone))
        if((await inspectMedia(ffmpeg,file)).hasAudio)roomFile=file
      }
      await exec(clipArgs({start,input,voiceFile:voice?voiceFile:undefined,overlays,audioIn,tempo,duration,width:outputWidth,height:outputHeight,fps,output:mid,fadeIn:inputs[i].fadeIn,fadeOut:inputs[i].fadeOut,grade:inputs[i].grade,bed:!!voice&&info.hasAudio&&!!inputs[i].ambientBed,ambientOnly:!voice&&info.hasAudio&&!inputs[i].muted&&!!inputs[i].ambientBed,roomFile}))
      if(roomFile){await ffmpeg.deleteFile(roomFile);files.delete(roomFile)}
      for(const o of overlays){try{await ffmpeg.deleteFile(o.file)}catch{/* already removed */}files.delete(o.file)}
      await ffmpeg.deleteFile(input);files.delete(input)
    }
    phase='concatenating';onProgress?.({phase,ratio:.8})
    files.add('concat.txt');files.add('output.mp4')
    await ffmpeg.writeFile('concat.txt',new TextEncoder().encode(inputs.map((_,i)=>`file 'mid_${i}.mp4'\nduration ${durations[i]}`).join('\n')))
    // Re-encode the joined timeline to remove per-clip AAC padding and timestamp drift.
    if(options?.bgm){files.add('bgm.bin');await ffmpeg.writeFile('bgm.bin',await fetchFile(options.bgm.blob))}
    await exec(finalArgs({total,fps,bgmFile:options?.bgm?'bgm.bin':undefined,bgmVolume:options?.bgm?.volume??0.22,output:'output.mp4'}))
    phase='validating';onProgress?.({phase,ratio:.97})
    const info=await inspectMedia(ffmpeg,'output.mp4')
    if(Math.abs(info.durationSec-total)>.1||info.width!==outputWidth||info.height!==outputHeight||!info.hasAudio)throw new Error('成片时长或音视频轨道校验未通过，请重试合成。')
    const data=await ffmpeg.readFile('output.mp4');checkAbort()
    if(typeof data==='string'||!data.length)throw new Error('成片文件为空')
    onValidated?.(info);onProgress?.({phase:'done',ratio:1})
    return new Blob([data.slice() as Uint8Array<ArrayBuffer>],{type:'video/mp4'})
  }catch(error){checkAbort();throw error}
  finally{
    signal?.removeEventListener('abort',abort);ffmpeg.off('progress',progress)
    for(const name of files)try{await ffmpeg.deleteFile(name)}catch{/* Worker may have been terminated. */}
  }
}
