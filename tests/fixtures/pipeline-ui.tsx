import React from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {StudioPage} from '../../src/pages/Studio'
import {db} from '../../src/core/storage/db'
import {loadFFmpeg} from '../../src/core/composition/ffmpeg'
import '../../src/styles/globals.css'
const win=window as unknown as {testResult?:unknown}
const check=(value:unknown,message:string)=>{if(!value)throw new Error(message)}
const status=(s:string)=>{document.getElementById('status')!.textContent=s}
async function until(test:()=>boolean,message:string){const start=Date.now();while(Date.now()-start<90000){if(test())return;await new Promise(r=>setTimeout(r,100))}throw new Error(message)}
async function run(){
 const ffmpeg=await loadFFmpeg()
 check(await ffmpeg.exec(['-y','-f','lavfi','-i','color=c=teal:s=180x320:r=25','-t','2','-c:v','libx264','-pix_fmt','yuv420p','ui.mp4'])===0,'UI fixture failed')
 const bytes=await ffmpeg.readFile('ui.mp4');if(typeof bytes==='string')throw new Error('Wrong fixture')
 const projectId='ui-auto-composition',video=new Blob([bytes.slice() as Uint8Array<ArrayBuffer>],{type:'video/mp4'})
 await db.projects.put({id:projectId,title:'自动剪辑流水线验证',status:'generating',createdAt:Date.now(),updatedAt:Date.now()})
 await db.productions.put({projectId,chapters:[],selectedId:'',promptsReady:true,autoCompose:true})
 for(let i=1;i<=2;i++){
  await db.assets.put({id:`ui-video-${i}`,projectId,kind:'video',mimeType:'video/mp4',blob:video,createdAt:Date.now()})
  await db.storyboards.put({id:`ui-shot-${i}`,projectId,sequence:i,sceneText:i===1?'同场中景建立空间':'切近景承接视线',narration:'',characterIds:[],videoAssetId:`ui-video-${i}`,durationSec:2,edit:{trimInSec:.2,trimOutSec:i===1?1.4:1.8,cutNote:'保持画面左右方向，以直接切换承接'},status:'video-ready'})
 }
 localStorage.setItem('studio-project',projectId)
 createRoot(document.getElementById('root')!).render(<MemoryRouter><StudioPage/></MemoryRouter>)
 status('等待镜头就绪后自动剪辑，不点击合成按钮')
 await until(()=>!!document.querySelector('[aria-label="剪辑合成 · 进行中"]'),'No automatic running node')
 await until(()=>!!document.querySelector('[aria-label="剪辑合成 · 已完成"]'),'Automatic composition did not finish')
 const exportButton=()=>document.querySelector('[aria-label="导出成片包 · 未执行"]') as HTMLButtonElement|null
 check(exportButton()&&!exportButton()!.disabled,'Final export is not enabled after composition')
 const prod=await db.productions.get(projectId)
 check(prod?.composition?.durationSec===2.8,'Wrong auto timeline')
 await db.productions.update(projectId,{autoCompose:false})
 await db.storyboards.update('ui-shot-1',{edit:{trimInSec:.2,trimOutSec:1.2}})
 await until(()=>!!exportButton()?.disabled,'Stale export not disabled')
 check(!!document.querySelector('[aria-label="剪辑合成 · 部分完成"]'),'Stale node not distinguished')
 await db.storyboards.update('ui-shot-1',{edit:{trimInSec:.2,trimOutSec:1.4,cutNote:'保持画面左右方向，以直接切换承接'}})
 await until(()=>!!document.querySelector('[aria-label="剪辑合成 · 已完成"]'),'Restored plan does not match saved final')
 status('自动触发、节点进度、完成后导出与过期拦截：全部通过')
 win.testResult={passed:true,automaticComposition:true,progressNode:true,exportEnabledOnComplete:true,staleExportBlocked:true,durationSec:prod!.composition!.durationSec,workflowNodes:Array.from(document.querySelectorAll('[aria-label]')).map(e=>e.getAttribute('aria-label')).filter(s=>s?.includes(' · '))}
}
run().catch(e=>{status(String(e));win.testResult={passed:false,error:e instanceof Error?e.stack:String(e)}})
