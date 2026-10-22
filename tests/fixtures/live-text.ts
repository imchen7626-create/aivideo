import {writeNovel,directPlan,directShots,sourceHash} from '../../src/core/pipeline/directing'
import {db} from '../../src/core/storage/db'
import {defaultPreset} from '../../src/core/pipeline/presets'
import {splitChapters} from '../../src/core/pipeline/chapters'
import type {Provider} from '../../src/types/domain'
const win=window as unknown as {liveProviders?:{llm:Provider;video:Provider};testResult?:unknown}
const status=(text:string)=>document.getElementById('status')!.textContent=text
async function run(){
 while(!win.liveProviders)await new Promise(r=>setTimeout(r,100))
 const {llm,video}=win.liveProviders,signal=AbortSignal.timeout(300000)
 status('真实文本模型：小说创作与修订（1/3）')
 const previous=(await db.productions.toArray()).filter(p=>p.projectId.startsWith('live-text-')&&p.novel&&p.plan&&!p.promptsReady).at(-1)
 const novel=previous?.novel??await writeNovel(llm,'创作约1000字完整现代成年言情短篇，女主林夏、男主周既白，地铁相识，女主因男主白皙修长手指产生好感；合作时慢慢了解；女主凭提前保存的设计邮件拿回被冒领的署名，男主支持但不代替女主解决；最后双方主动约会，圆满结局。人物关系和事实要自洽。只需一章，结尾完整。',signal)
 const id='live-text-'+Date.now(),project={id,title:novel.title,style:defaultPreset.style,status:'draft' as const,createdAt:Date.now(),updatedAt:Date.now()},preset={...defaultPreset,durationSec:30 as const,budget:'economy' as const}
 const characters=[{id:'live-f',projectId:id,name:'林夏',description:'成年女性设计师，黑色齐肩发，米色风衣，拿回署名，保留自主选择',role:'protagonist' as const,locked:false,createdAt:Date.now()},{id:'live-m',projectId:id,name:'周既白',description:'成年男性，白皙纤长手指，黑色短发，深蓝衬衫，温和克制，不代替女主解决事业冲突',role:'protagonist' as const,locked:false,createdAt:Date.now()}]
 await db.projects.put(project);await db.characters.bulkPut(characters)
 const chapters=splitChapters(novel.text),chapter=chapters[0]
 status('真实文本模型：30秒改编与取舍（2/3）')
 const plan=previous?.plan??await directPlan(llm,chapter,project,characters,preset,signal),production={projectId:id,chapters,selectedId:chapter.id,preset,novel,plan,sourceHash:await sourceHash(chapter.text)}
 await db.productions.put(production)
 status('真实文本模型：结构化分镜和剪辑计划（3/3）')
 await directShots(llm,video,production,project,characters,preset,signal)
 const shots=await db.storyboards.where('projectId').equals(id).sortBy('sequence')
 status('实际模型调用通过；没有提交图片、视频或语音生成')
 win.testResult={passed:true,providerMode:'live user-configured text provider',model:llm.model,paidTextCalls:previous?1:3,reusedSavedNovelAndPlan:!!previous,paidMediaCalls:0,novelChars:novel.text.length,sourceHash:novel.hash,shots:shots.length,duration:shots.reduce((a,b)=>a+b.edit!.trimOutSec-b.edit!.trimInSec,0),liveFiles:{novel,plan,shots}}
}
run().catch(e=>{status(String(e));win.testResult={passed:false,error:e instanceof Error?e.stack:String(e)}})
