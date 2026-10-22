import React from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {StudioPage} from '../../src/pages/Studio'
import {ingestNovel} from '../../src/core/pipeline/ingest'
import {useSettingsStore} from '../../src/store/settings'
import {db} from '../../src/core/storage/db'
import {loadFFmpeg} from '../../src/core/composition/ffmpeg'
import {concatVideos,inspectMedia} from '../../src/core/composition/concat'
import {queuePipeline,runPipeline,stopPipeline,newAutomation,replaceSource} from '../../src/core/pipeline/runner'
import {writeNovel} from '../../src/core/pipeline/directing'
import {defaultPreset} from '../../src/core/pipeline/presets'
import {updateStoryboard} from '../../src/core/storage/storyboards'
import {buildProductionPackage} from '../../src/core/export/production'
import JSZip from 'jszip'
import '../../src/styles/globals.css'

const win=window as unknown as {testResult?:unknown},status=(s:string)=>document.getElementById('status')!.textContent=s
const check=(v:unknown,m:string)=>{if(!v)throw new Error(m)}
const wait=async(test:()=>Promise<boolean>|boolean,message:string,timeout=180000)=>{const start=Date.now();while(Date.now()-start<timeout){if(await test())return;await new Promise(r=>setTimeout(r,100))}throw new Error(message)}
const toBase64=(blob:Blob)=>new Promise<string>(resolve=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.readAsDataURL(blob)})

async function run(){
 status('生成真实编码测试视频与音频，接口响应使用协议桩，不调用付费模型')
 const ffmpeg=await loadFFmpeg(),logs:string[]=[];ffmpeg.on('log',({message})=>logs.push(message))
 check(await ffmpeg.exec(['-y','-f','lavfi','-i','color=c=teal:s=180x320:r=25','-t','5','-c:v','libx264','-pix_fmt','yuv420p','auto.mp4'])===0,'Fixture video failed')
 check(await ffmpeg.exec(['-y','-f','lavfi','-i','sine=frequency=450:sample_rate=44100','-t','1','voice.wav'])===0,'Fixture audio failed')
 const bytes=await ffmpeg.readFile('auto.mp4'),voiceBytes=await ffmpeg.readFile('voice.wav');if(typeof bytes==='string'||typeof voiceBytes==='string')throw new Error('Wrong fixture')
 const video=new Blob([bytes.slice() as Uint8Array<ArrayBuffer>],{type:'video/mp4'}),voice=new Blob([voiceBytes.slice() as Uint8Array<ArrayBuffer>],{type:'audio/wav'}),videoUrl=URL.createObjectURL(video)
 const counts={text:0,image:0,video:0,voice:0,poll:0},originalFetch=window.fetch.bind(window)
 let failImageOnce=true,holdPoll=false
 const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII='
 window.fetch=async(input,init)=>{
  const url=String(input)
  if(!url.startsWith('/test-provider'))return originalFetch(input,init)
  if(init?.signal?.aborted)throw new DOMException('Aborted','AbortError')
  const body=JSON.parse(String(init?.body??'{}'))
  const json=(v:unknown,code=200)=>new Response(JSON.stringify(v),{status:code,headers:{'Content-Type':'application/json'}})
  if(url.endsWith('/chat/completions')){
   counts.text++;const system=body.messages[0].content as string;let data:unknown
   if(system.includes('小说作家'))data={title:'雨后回声',text:'雨后回声\n第一章\n'+('她在地铁上归还了他的车票。他记住了她的名字。她凭提前保留的邮件拿回设计署名，他在下班后的站台等她。两人坦白心意，约好下一站一起下车。\n'.repeat(8)),revisionNotes:['补足署名证据铺垫和双方主动选择']}
   else if(system.includes('选角导演'))data={characters:[{name:'林夏',role:'protagonist',description:'成年女性，短发，米色外套，争取作品署名'}]}
   else if(system.includes('"beats"'))data={logline:'拿回署名后赴约',hook:'车票',ending:'一起下车',beats:[{title:'相遇',description:'归还车票',durationSec:5},{title:'损失',description:'署名被拿走',durationSec:10},{title:'选择',description:'邮件举证',durationSec:10},{title:'回报',description:'站台赴约',durationSec:5}]}
   else data={shots:Array.from({length:6},(_,i)=>({sequence:i+1,scene_text:'林夏在站台看向画面右侧，抬眼微笑',narration:'赴约',image_prompt:'Adult woman, short black hair, beige coat, station platform, medium shot, soft daylight',video_prompt:'She slowly raises her gaze toward screen right and smiles, static camera',character_names:['林夏'],duration_sec:5,direction:{scene:'站台/傍晚',purpose:'人物选择',framing:i%2?'近景':'中景',eyeline:'看向画面右侧',sound:'后期旁白',sourceExcerpt:'她在地铁上'},edit:{trimInSec:0,trimOutSec:5,entryState:'垂眼',exitState:'看向右侧微笑',cutNote:'保持视线方向，切到反应'}}))}
   return new Response('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify(data)}}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}})
  }
  if(url.endsWith('/images/generations')){counts.image++;if(failImageOnce&&counts.image===2){failImageOnce=false;return json({error:'fixture failure'},503)}return json({data:[{b64_json:image}]})}
  if(url.endsWith('/videos/generations')){counts.video++;return json({id:'task-'+counts.video})}
  if(url.includes('/videos/generations/')){counts.poll++;return json(holdPoll?{status:'processing'}:{status:'completed',url:videoUrl})}
  if(url.endsWith('/audio/speech')){counts.voice++;return new Response(voice,{headers:{'Content-Type':'audio/wav'}})}
  return json({data:[]})
 }
 useSettingsStore.getState().resetAll()
 const settings=useSettingsStore.getState(),providers={llm:settings.addProvider({label:'测试文本',kind:'llm',baseUrl:'/test-provider',apiKey:'',model:'fixture-text'}),text2image:settings.addProvider({label:'测试图像',kind:'text2image',baseUrl:'/test-provider',apiKey:'',model:'fixture-image'}),image2video:settings.addProvider({label:'测试视频',kind:'image2video',baseUrl:'/test-provider',apiKey:'',model:'fixture-video'}),tts:settings.addProvider({label:'测试语音',kind:'tts',baseUrl:'/test-provider',apiKey:'',model:'fixture-voice'})}
 const preset={...defaultPreset,durationSec:30 as const,audio:'narration' as const,maxSubmissions:40}
 localStorage.setItem('studio-preset',JSON.stringify(preset))
 const file=new File(['第一章\n她在地铁上归还了车票，之后凭邮件拿回署名，在站台约定一起下车。'],'自动测试.txt',{type:'text/plain'})
 const id=await ingestNovel(file,preset);localStorage.setItem('studio-project',id)
 createRoot(document.getElementById('root')!).render(<MemoryRouter><StudioPage/></MemoryRouter>)
 status('验证上传自动执行，单镜头失败后仍保存其他成功素材')
 await wait(async()=>{const p=await db.productions.get(id);return p?.automation?.status==='failed'},'Expected one image failure')
 const partial=await db.storyboards.where('projectId').equals(id).toArray()
 check(partial.filter(s=>s.videoAssetId).length===5,'Successful shots were not retained')
 const before={...counts};await queuePipeline(id)
 status('恢复失败镜头并继续配音、实际剪辑、自动打包')
 await wait(async()=>{const p=await db.productions.get(id);if(p?.automation?.status==='failed')throw new Error(p.automation.error);return p?.automation?.status==='done'},'Automatic pipeline did not finish')
 check(counts.image-before.image===1&&counts.video-before.video===1,'Retry regenerated successful paid shots')
 let prod=await db.productions.get(id)
 check(prod?.packageAssetId&&prod.composition?.durationSec===30,'No final/package persisted')
 const final=await db.assets.get(prod!.composition!.assetId),zip=await JSZip.loadAsync((await db.assets.get(prod!.packageAssetId!))!.blob)
 check(zip.file('final.mp4')&&zip.file('分镜脚本.md')&&zip.file('小说.txt')&&zip.file('subtitles.srt'),'Missing final package deliverables')
 const result=document.getElementById('result') as HTMLVideoElement;result.src=URL.createObjectURL(final!.blob)
 await new Promise<void>((resolve,reject)=>{result.onloadeddata=()=>resolve();result.onerror=()=>reject(new Error('MP4 playback failed'))})
 check(result.duration===30&&result.videoWidth===720,'Final duration/geometry wrong')
 const novel=await writeNovel(providers.llm,'地铁相识，归还车票，拿回署名，圆满结局',new AbortController().signal)
 check(novel.hash.length===64&&novel.text.length>300,'Novel not saved with source hash')
 const novelId=await ingestNovel(new File([novel.text],'小说.txt'),{...preset,mode:'professional'})
 await db.productions.update(novelId,{novel});check((await db.materials.where('projectId').equals(novelId).first())?.text===novel.text,'TXT source not persisted')
 // Reuse completed footage to test novel -> adaptation -> automatic pipeline without another paid media batch.
 const originalShots=await db.storyboards.where('projectId').equals(id).toArray()
 await db.characters.bulkPut((await db.characters.where('projectId').equals(id).toArray()).map(c=>({...c,id:c.id+'n',projectId:novelId})))
 for(const shot of originalShots){for(const assetId of [shot.imageAssetId,shot.videoAssetId,shot.audioAssetId]){const asset=assetId?await db.assets.get(assetId):undefined;if(asset)await db.assets.put({...asset,id:asset.id+'n',projectId:novelId})}await db.storyboards.put({...shot,id:shot.id+'n',projectId:novelId,imageAssetId:shot.imageAssetId+'n',videoAssetId:shot.videoAssetId+'n',audioAssetId:shot.audioAssetId+'n',characterIds:shot.characterIds.map(c=>c+'n')})}
 await db.productions.update(novelId,{plan:prod!.plan,promptsReady:true,automation:{...newAutomation(),status:'paused'}})
 await queuePipeline(novelId);await runPipeline(novelId,providers);check((await db.productions.get(novelId))?.automation?.status==='done','Novel continuation failed')
 // A retained remote handle must be polled after pause/resume, never resubmitted.
 status('验证暂停、取消、任务句柄恢复及不重复提交')
 const first=originalShots[0];await db.storyboards.update(first.id,{videoAssetId:undefined,pendingVideoTask:{taskId:'retained-task',apiFlavor:'openai-compatible',submittedAt:Date.now(),providerId:providers.image2video.id,baseUrl:'/test-provider',model:'fixture-video'}})
 holdPoll=true;await queuePipeline(id);await wait(async()=>{const p=await db.productions.get(id);return p?.automation?.stage==='video'&&p.automation.status==='running'},'No resumed video task');await stopPipeline(id,true)
 await wait(()=>!document.querySelector('[aria-label="自动生产控制台"]')?.textContent?.includes('● 执行中'),'Cancellation not reflected')
 await new Promise(r=>setTimeout(r,200));holdPoll=false;const videoBefore=counts.video
 await queuePipeline(id,true);await wait(async()=>{const p=await db.productions.get(id);if(p?.automation?.status==='failed')throw new Error(p.automation.error);return p?.automation?.status==='done'},'Pending task recovery failed')
 check(counts.video===videoBefore,'Existing task was submitted again')
 const shotsAfter=await db.storyboards.where('projectId').equals(id).toArray();await updateStoryboard(shotsAfter[1].id,{narration:'新旁白'})
 let stale=false;try{await buildProductionPackage((await db.projects.get(id))!)}catch{stale=true}check(stale,'Stale final not blocked')
 const imagesBefore=counts.image,videosBefore=counts.video,voicesBefore=counts.voice;await queuePipeline(id);await wait(async()=>{const p=await db.productions.get(id);return p?.automation?.status==='done'},'Audio-only update failed')
 check(counts.image===imagesBefore&&counts.video===videosBefore&&counts.voice===voicesBefore+1,'Changed narration regenerated unrelated media')
 let overlong=false;try{await concatVideos([{blob:video,name:'对白超长',durationSec:.5,audioBlob:voice}])}catch(e){overlong=String(e).includes('超过镜长')}check(overlong,'Narration was silently truncated')
 const horizontal=await concatVideos([{blob:video,name:'横屏',durationSec:1,audioBlob:voice}],{outputWidth:320,outputHeight:180})
 await ffmpeg.writeFile('horizontal.mp4',new Uint8Array(await horizontal.arrayBuffer()));check((await inspectMedia(ffmpeg,'horizontal.mp4')).width===320,'Landscape failed')
 // Budget and uncertain submission checks do not issue any paid fixture calls.
 await db.productions.update(novelId,{preset:{...preset,maxSubmissions:10},automation:{...newAutomation(),status:'paused',submissions:10,operations:{uncertain:{status:'started',at:Date.now()}}}})
 let uncertainBlocked=false;try{await queuePipeline(novelId)}catch{uncertainBlocked=true}check(uncertainBlocked,'Uncertain paid request was retried without acknowledgment')
 const sourceBefore=await db.assets.count();await replaceSource(novelId,'第一章\n她保存了证据，拿回署名，并主动约他在下一站见。')
 check(!(await db.productions.get(novelId))?.promptsReady&&(await db.assets.count())>sourceBefore,'Source revision not archived/invalidated')
 status('自动制作、失败恢复、声音、实际编码和成片包验证通过')
 win.testResult={passed:true,providerMode:'protocol fixtures, no live paid model calls',uploadAuto:true,novelSourceHash:true,novelContinuation:true,retryOnlyFailed:true,pauseCancelResume:true,pendingVideoNoResubmit:true,staleBlocked:true,narrationOnlyRerun:true,overlongNarrationBlocked:true,horizontal:true,uncertainBlocked:true,sourceVersionArchived:true,counts,duration:result.duration,width:result.videoWidth,height:result.videoHeight,zipFiles:Object.keys(zip.files).length,finalBase64:await toBase64(final!.blob)}
}
run().catch(e=>{status(String(e));win.testResult={passed:false,error:e instanceof Error?e.stack:String(e)}})
