import {db} from '../../src/core/storage/db'
import {generateShotVideo} from '../../src/core/pipeline/video-shot'
const win=window as unknown as {testResult?:unknown},status=(s:string)=>document.getElementById('status')!.textContent=s
const provider={id:'restart-provider',label:'恢复协议验证',kind:'image2video' as const,baseUrl:'/restart-provider',model:'fixture-video',apiKey:''}
async function run(){
 if(new URLSearchParams(location.search).get('phase')==='seed'){
  await db.assets.put({id:'restart-image',projectId:'restart',kind:'image',mimeType:'image/png',blob:new Blob(['persisted first frame']),createdAt:Date.now()})
  await db.storyboards.put({id:'restart-shot',projectId:'restart',sequence:1,sceneText:'固定机位，人物抬眼',characterIds:[],imageAssetId:'restart-image',durationSec:5,status:'image-ready',pendingVideoTask:{taskId:'existing-remote-task',apiFlavor:'openai-compatible',providerId:provider.id,baseUrl:provider.baseUrl,model:provider.model,submittedAt:Date.now()}})
  status('任务句柄和首帧已写入真实 IndexedDB，即将退出整个 Electron 进程')
  win.testResult={passed:true,phase:'seed',nativeIndexedDb:true,taskId:'existing-remote-task'};return
 }
 const shot=await db.storyboards.get('restart-shot'),image=await db.assets.get('restart-image')
 if(shot?.pendingVideoTask?.taskId!=='existing-remote-task'||!image?.blob.size)throw new Error('Pending task/first frame did not survive a process restart')
 const original=window.fetch.bind(window);let submitted=0,polled=0
 const fixture=await original('/real-fixture.json').then(r=>r.json()),videoUrl='/clips/'+fixture.shots[0].videoAssetId+'.mp4'
 window.fetch=async(input,init)=>{if(String(input).startsWith('/restart-provider')){if(init?.method==='POST'){submitted++;throw new Error('Must not submit again')}polled++;return Response.json({status:'completed',url:videoUrl})}return original(input,init)}
 for await(const event of generateShotVideo({provider,storyboard:shot,pollIntervalMs:0})){if(event.phase==='error')throw new Error(event.message)}
 const saved=await db.storyboards.get(shot.id),asset=saved?.videoAssetId?await db.assets.get(saved.videoAssetId):undefined
 if(submitted||polled!==1||!asset?.blob.size||saved?.pendingVideoTask)throw new Error('Resume submitted a duplicate or failed to persist the result')
 status('整个 Electron 进程退出并重开后，原任务查询及素材恢复通过')
 win.testResult={passed:true,phase:'reopened',survivedProcessRestart:true,retainedImage:true,submissions:submitted,polls:polled,realVideoBytes:asset.blob.size}
}
run().catch(e=>{status(String(e));win.testResult={passed:false,error:e instanceof Error?e.stack:String(e)}})
