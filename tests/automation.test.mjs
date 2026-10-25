import {test,after} from 'node:test'
import assert from 'node:assert/strict'
import {registerHooks} from 'node:module'
import {existsSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import 'fake-indexeddb/auto'
registerHooks({resolve(s,c,next){if(s.endsWith('.txt?raw'))return {url:new URL('../src/core/prompts/vendor/zenstory-action.txt',import.meta.url).href,shortCircuit:true};const u=s.startsWith('@/')?new URL('../src/'+s.slice(2),import.meta.url):s.startsWith('.')?new URL(s,c.parentURL):null;if(u?.protocol==='file:'&&existsSync(fileURLToPath(u)+'.ts'))return next(u.href+'.ts',c);return next(s,c)},load(url,context,next){if(url.endsWith('zenstory-action.txt'))return {format:'module',source:'export default "通过行动和关键细节展现情绪"',shortCircuit:true};return next(url,context)}})
const {normalizePreset,defaultPreset,preflight,videoDurations}=await import('../src/core/pipeline/presets.ts')
const {db}=await import('../src/core/storage/db.ts')
const {runPipeline,newAutomation,queuePipeline,replaceSource}=await import('../src/core/pipeline/runner.ts')
const {updateStoryboard}=await import('../src/core/storage/storyboards.ts')
const {buildEditTimeline}=await import('../src/core/composition/plan.ts')
after(()=>db.close())
const providers=Object.fromEntries(['llm','text2image','image2video'].map(kind=>[kind,{id:kind,kind,model:'test',baseUrl:'https://example.invalid',apiKey:''}]))
test('preset defaults, request caps and required model capabilities are validated before submission',()=>{
 assert.equal(normalizePreset().durationSec,60)
 assert.equal(normalizePreset({durationSec:40,maxSubmissions:900}).durationSec,60)
 assert.equal(normalizePreset({maxSubmissions:900}).maxSubmissions,200)
 assert.deepEqual(preflight(defaultPreset,providers),[])
 assert.match(preflight({...defaultPreset,audio:'narration'},providers).join(),/语音/)
 assert.match(preflight(defaultPreset,{...providers,text2image:{...providers.text2image,model:'deepseek-chat'}}).join(),/文本模型/)
 assert.deepEqual(videoDurations({...providers.image2video,apiFlavor:'aliyun',model:'wan3.0-video'}),[3,4,5,6,7,8],'wan3.0 takes any whole second')
 assert.deepEqual(videoDurations({...providers.image2video,apiFlavor:'aliyun',model:'wan2.6-i2v'}),[5,10])
})
test('request limit blocks generation without discarding completed shot assets',async t=>{
 const id='budget-test';await db.projects.put({id,title:'test'})
 await db.characters.put({id:'budget-c',projectId:id,name:'A'})
 await db.productions.put({projectId:id,chapters:[{id:'c',title:'c',text:'小说'}],selectedId:'c',plan:{},promptsReady:true,preset:{...defaultPreset,maxSubmissions:10},automation:{...newAutomation(),submissions:10}})
 await db.storyboards.put({id:'budget-s',projectId:id,sequence:1,characterIds:[],sceneText:'scene',imagePrompt:'image',durationSec:5})
 const fetch=t.mock.method(globalThis,'fetch',async()=>{throw new Error('must not submit')})
 await runPipeline(id,providers)
 const p=await db.productions.get(id);assert.equal(p.automation.status,'failed');assert.match(p.automation.error,/次数上限/);assert.equal(fetch.mock.callCount(),0)
})
test('uncertain requests require acknowledgement, while retained video handles resume without it',async()=>{
 const id='uncertain-test';await db.productions.put({projectId:id,chapters:[],selectedId:'',automation:{...newAutomation(),operations:{unknown:{status:'started',at:0}}}})
 await assert.rejects(()=>queuePipeline(id),/可能已计费/)
 await queuePipeline(id,true);assert.equal((await db.productions.get(id)).automation.status,'queued')
 await db.storyboards.put({id:'pending',projectId:id,pendingVideoTask:{taskId:'remote'}})
 await db.productions.update(id,{automation:{...newAutomation(),operations:{'video:pending':{status:'started',at:0}}}})
 await queuePipeline(id);assert.equal((await db.productions.get(id)).automation.operations['video:pending'].status,'done')
})
test('motion edits retain the first frame and detach video; narration edits only detach voice',async()=>{
 await db.storyboards.put({id:'edit',projectId:'edits',sequence:1,characterIds:[],sceneText:'old',imageAssetId:'image',videoAssetId:'video',audioAssetId:'audio'})
 await updateStoryboard('edit',{narration:'new'});let shot=await db.storyboards.get('edit');assert.equal(shot.imageAssetId,'image');assert.equal(shot.videoAssetId,'video');assert.equal(shot.audioAssetId,undefined)
 await updateStoryboard('edit',{sceneText:'new action'});shot=await db.storyboards.get('edit');assert.equal(shot.imageAssetId,'image');assert.equal(shot.videoAssetId,undefined)
 await db.storyboards.update('edit',{pendingVideoTask:{taskId:'remote'}});await assert.rejects(()=>updateStoryboard('edit',{imagePrompt:'new'}),/远端/)
})
test('output geometry and voice mode changes invalidate a final even if footage is unchanged',()=>{
 const shots=[{id:'s',sequence:1,characterIds:[],sceneText:'scene',videoAssetId:'v',durationSec:5,audioAssetId:'voice'}]
 const portrait=buildEditTimeline(shots);assert.equal(buildEditTimeline(shots,{aspectRatio:'16:9'}).width,1280)
 assert.notEqual(portrait.fingerprint,buildEditTimeline(shots,{aspectRatio:'16:9'}).fingerprint)
 assert.notEqual(portrait.fingerprint,buildEditTimeline(shots,{audio:'narration'}).fingerprint)
})
test('source revisions archive metadata and media and invalidate all derived story nodes',async()=>{
 const id='source';await db.productions.put({projectId:id,chapters:[{id:'c',text:'old'}],plan:{},promptsReady:true,automation:{...newAutomation(),status:'paused',submissions:8}})
 await db.assets.put({id:'retained',projectId:id,blob:new Blob(['old video'])});await db.storyboards.put({id:'old-shot',projectId:id,videoAssetId:'retained'})
 await replaceSource(id,'第一章\n新的正文');const p=await db.productions.get(id)
 assert.equal(p.plan,undefined);assert.equal(p.promptsReady,false);assert.equal(await db.storyboards.where('projectId').equals(id).count(),0);assert.ok(await db.assets.get('retained'));assert.equal(p.automation.submissions,8)
 assert.equal(await db.assets.where('projectId').equals(id).count(),2)
})
test('malformed text output is repaired once, with both requests counted and no media generation',async t=>{
 const id='repair-limit';await db.projects.put({id,title:'repair'});await db.productions.put({projectId:id,chapters:[{id:'c',text:'章节原文'}],selectedId:'c',preset:defaultPreset,automation:newAutomation()})
 const calls=t.mock.method(globalThis,'fetch',async()=>new Response('data: '+JSON.stringify({choices:[{delta:{content:'{"characters":[]}'}}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}}))
 await runPipeline(id,providers);const prod=await db.productions.get(id)
 assert.equal(calls.mock.callCount(),2);assert.equal(prod.automation.submissions,2);assert.equal(prod.automation.status,'failed')
})
