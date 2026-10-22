import {loadFFmpeg} from '../../src/core/composition/ffmpeg'
import {concatVideos,inspectMedia} from '../../src/core/composition/concat'
import {composeProject} from '../../src/core/composition/project'
import {db} from '../../src/core/storage/db'
import {buildProductionPackage} from '../../src/core/export/production'
import JSZip from 'jszip'
const win=window as unknown as {testResult?:unknown}
const status=(text:string)=>{document.getElementById('status')!.textContent=text}
const check=(value:unknown,message:string)=>{if(!value)throw new Error(message)}
const base64=(blob:Blob)=>new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(r.error);r.readAsDataURL(blob)})
async function run(){
 const ffmpeg=await loadFFmpeg(),log:string[]=[]
 ffmpeg.on('log',({message})=>{log.push(message);if(log.length>20)log.shift()})
 const exec=async(args:string[])=>{const code=await ffmpeg.exec(['-y',...args]);check(code===0,'Fixture generation failed: '+log.join('\n'))}
 status('生成横屏有声、竖屏无声测试片段')
 await exec(['-f','lavfi','-i','color=c=red:s=320x180:r=24','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','red.mp4'])
 await exec(['-f','lavfi','-i','color=c=blue:s=180x320:r=30','-t','2','-c:v','libx264','-pix_fmt','yuv420p','blue.mp4'])
 const blob=async(name:string)=>{const data=await ffmpeg.readFile(name);if(typeof data==='string')throw new Error('Wrong file type');return new Blob([data.slice() as Uint8Array<ArrayBuffer>],{type:'video/mp4'})}
 const red=await blob('red.mp4'),blue=await blob('blue.mp4')
 status('验证混合音轨、画幅和裁剪')
 const mixed=await concatVideos([{blob:red,name:'red',durationSec:1.2,trimInSec:.2},{blob:blue,name:'blue',durationSec:1.6,trimInSec:.2}],{outputWidth:180,outputHeight:320})
 await ffmpeg.writeFile('mixed.mp4',new Uint8Array(await mixed.arrayBuffer()))
 const mixedInfo=await inspectMedia(ffmpeg,'mixed.mp4')
 check(Math.abs(mixedInfo.durationSec-2.8)<.1&&mixedInfo.hasAudio&&mixedInfo.width===180,'Mixed audio/geometry validation failed')
 let shortRejected=false
 try{await concatVideos([{blob:blue,name:'short',durationSec:3}])}catch(e){shortRejected=e instanceof Error&&e.message.includes('实际只有')}
 check(shortRejected,'Short source must not silently stretch')
 const cancelled=new AbortController();cancelled.abort();let cancelledRejected=false
 try{await concatVideos([{blob:blue,name:'cancel'}],{signal:cancelled.signal})}catch(e){cancelledRejected=e instanceof Error&&e.name==='AbortError'}
 check(cancelledRejected,'Abort was ignored')
 const fixture=await fetch('/real-fixture.json').then(r=>r.json())
 const projectId='composition-browser-test',project={...fixture.project,id:projectId}
 await db.projects.put(project)
 await db.productions.put({...fixture.production,projectId,composition:undefined,exportedAt:undefined})
 const assetMap=new Map<string,string>()
 for(const shot of fixture.shots){
  const assetId='test-'+shot.videoAssetId
  const media=await fetch('/clips/'+shot.videoAssetId+'.mp4').then(r=>r.blob())
  assetMap.set(shot.videoAssetId,assetId)
  await db.assets.put({id:assetId,projectId,kind:'video',mimeType:'video/mp4',blob:media,createdAt:Date.now()})
  await db.storyboards.put({...shot,id:'test-'+shot.id,projectId,videoAssetId:assetId,imageAssetId:undefined,pendingVideoTask:undefined})
 }
 status('对12个真实镜头执行完整剪辑流水线')
 const result=await composeProject(projectId,p=>status(`${p.phase} ${p.currentClip??''}/${p.totalClips??''} ${Math.round((p.ratio??0)*100)}%`))
 const final=await db.assets.get(result.assetId)
 check(final?.blob.size,'No persisted final')
 check(result.shotCount===12&&Math.abs(result.durationSec-60)<.1,'Wrong real timeline')
 check((await db.productions.get(projectId))?.nodeRuns?.compose?.status==='done','Composition node not done')
 status('验证成片包和过期成片拦截')
 const zip=await JSZip.loadAsync(await buildProductionPackage(project))
 check(zip.file('final.mp4')&&zip.file('edit-timeline.json')&&zip.file('composition-checks.json'),'Final package missing timeline')
 const manifest=JSON.parse(await zip.file('production-manifest.json')!.async('text'))
 check(manifest.finalIncluded&&manifest.completedVideos===12,'Wrong package manifest')
 const first=await db.storyboards.where('projectId').equals(projectId).first()
 await db.storyboards.update(first!.id,{edit:{trimInSec:0,trimOutSec:4}})
 let staleRejected=false
 try{await buildProductionPackage(project)}catch(e){staleRejected=e instanceof Error&&e.message.includes('分镜已修改')}
 check(staleRejected,'Stale composition was exported')
 const video=document.getElementById('result') as HTMLVideoElement
 video.src=URL.createObjectURL(final!.blob)
 await new Promise<void>((resolve,reject)=>{video.onloadeddata=()=>resolve();video.onerror=()=>reject(new Error('Final MP4 does not decode'))})
 check(Math.abs(video.duration-60)<.1&&video.videoWidth===720&&video.videoHeight===1280,'Native playback metadata mismatch')
 status('全部验证通过')
 await ffmpeg.writeFile('review-final.mp4',new Uint8Array(await final!.blob.arrayBuffer()))
 const contactCode=await ffmpeg.exec(['-y','-i','review-final.mp4','-vf','fps=1/10,scale=180:320,tile=6x1','-frames:v','1','contact.jpg'])
 const contact=contactCode===0?await ffmpeg.readFile('contact.jpg'):undefined
 win.testResult={passed:true,mixedInfo,shortRejected,cancelledRejected,staleRejected,realShots:result.shotCount,duration:video.duration,width:video.videoWidth,height:video.videoHeight,zipFiles:Object.keys(zip.files).length,checks:result.checks,finalBase64:await base64(final!.blob),packageBase64:await base64(await zip.generateAsync({type:'blob'})),contactSheetBase64:contact&&typeof contact!=='string'?await base64(new Blob([contact.slice() as Uint8Array<ArrayBuffer>],{type:'image/jpeg'})):undefined}
}
run().catch(e=>{status(String(e));win.testResult={passed:false,error:e instanceof Error?e.stack:String(e)}})
