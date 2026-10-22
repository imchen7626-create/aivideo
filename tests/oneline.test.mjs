import {test,after} from 'node:test'
import assert from 'node:assert/strict'
import {registerHooks} from 'node:module'
import {existsSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import 'fake-indexeddb/auto'
registerHooks({resolve(s,c,next){if(s.endsWith('.txt?raw'))return {url:new URL('../src/core/prompts/vendor/zenstory-action.txt',import.meta.url).href,shortCircuit:true};const u=s.startsWith('@/')?new URL('../src/'+s.slice(2),import.meta.url):s.startsWith('.')?new URL(s,c.parentURL):null;if(u?.protocol==='file:'&&existsSync(fileURLToPath(u)+'.ts'))return next(u.href+'.ts',c);return next(s,c)},load(url,context,next){if(url.endsWith('zenstory-action.txt'))return {format:'module',source:'export default "通过行动和关键细节展现情绪"',shortCircuit:true};return next(url,context)}})
const {splitCaption,timeCaptions}=await import('../src/core/composition/captions.ts')
const {resolveProviders,resolveAudio,normalizePreset,deriveBailianTts,defaultPreset,applyModelSettings}=await import('../src/core/pipeline/presets.ts')
const {generateTtsAudio}=await import('../src/core/composition/tts.ts')
const {clipArgs,finalArgs}=await import('../src/core/composition/concat.ts')
const {db}=await import('../src/core/storage/db.ts')
const {runPipeline,runPool,newAutomation}=await import('../src/core/pipeline/runner.ts')
const {storyWordsFor}=await import('../src/core/pipeline/directing.ts')
after(()=>db.close())

test('captions split at punctuation, drop trailing commas and stay within line length',()=>{
 const parts=splitCaption('她攥紧那张旧照片，指尖发白。下一秒，她把它狠狠拍在了董事长的办公桌上！',14)
 assert.ok(parts.length>=3)
 for(const p of parts){assert.ok([...p].length<=14,p);assert.doesNotMatch(p,/[，。]$/)}
 assert.match(parts.at(-1),/！$/)
 assert.deepEqual(splitCaption('   '),[])
 const cues=timeCaptions(['一二三','四五六七八九'],3,5)
 assert.equal(cues[0].start,0);assert.equal(cues[0].end,1);assert.equal(cues[1].end,5)
})

test('a Bailian key is reused for Qwen-TTS when no speech service is configured',()=>{
 const video={id:'v',kind:'image2video',label:'v',baseUrl:'https://ws-1.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',apiKey:'sk-x',model:'wan3.0-video',apiFlavor:'aliyun'}
 const llm={id:'l',kind:'llm',label:'l',baseUrl:'https://api.deepseek.com',apiKey:'sk-d',model:'deepseek-chat'}
 const resolved=resolveProviders(normalizePreset(),[llm,video],{llm:'l',image2video:'v'})
 assert.equal(resolved.tts.model,'qwen3-tts-flash')
 assert.equal(resolved.tts.baseUrl,'https://ws-1.cn-beijing.maas.aliyuncs.com')
 assert.equal(resolved.tts.apiKey,'sk-x')
 assert.equal(resolveAudio(normalizePreset(),resolved).audio,'dialogue')
 assert.equal(deriveBailianTts([llm]),undefined)
 assert.equal(resolveAudio(normalizePreset(),{llm}).audio,'original')
 // An explicit choice is never overridden.
 assert.equal(resolveAudio(normalizePreset({audio:'original'}),resolved).audio,'original')
 assert.equal(normalizePreset({concurrency:9}).concurrency,4)
 assert.equal(storyWordsFor(30),600)
})

test('Qwen-TTS request goes through the local proxy and downloads the returned audio',async t=>{
 const calls=[]
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  calls.push({url:String(url),init})
  if(String(url).includes('multimodal-generation'))return new Response(JSON.stringify({output:{audio:{url:'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a.wav'}}}),{headers:{'content-type':'application/json'}})
  return new Response(new Uint8Array(2000),{headers:{'content-type':'audio/wav'}})
 })
 const blob=await generateTtsAudio({baseUrl:'/api/bailian',apiKey:'sk-1',model:'qwen3-tts-flash'},{model:'qwen3-tts-flash',text:'你好',voice:'Ethan',language:'Chinese'})
 assert.equal(blob.size,2000)
 assert.equal(calls[0].url,'/api/bailian/api/v1/services/aigc/multimodal-generation/generation')
 assert.deepEqual(JSON.parse(calls[0].init.body).input,{text:'你好',voice:'Ethan',language_type:'Chinese'})
 assert.match(calls[1].url,/^\/api\/bailian\/media\?url=/)
})

test('runPool bounds concurrency and still waits for every worker',async()=>{
 let active=0,peak=0
 const seen=[]
 await runPool([1,2,3,4,5,6,7],3,async n=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5+n));seen.push(n);active--})
 assert.equal(peak,3);assert.equal(seen.length,7)
 await assert.rejects(runPool([1,2,3],2,async n=>{if(n===1)throw new Error('boom')}),/boom/)
})

test('concurrent shot generation counts every paid submission exactly once',async t=>{
 const id='conc-test';await db.projects.put({id,title:'并发'})
 await db.productions.put({projectId:id,chapters:[{id:'c',title:'c',text:'小说'}],selectedId:'c',plan:{logline:'',hook:'',ending:'',beats:[]},promptsReady:true,preset:{...defaultPreset,audio:'original',concurrency:3,maxSubmissions:50},automation:{...newAutomation(),submissions:0}})
 await db.characters.put({id:'conc-c',projectId:id,name:'A',role:'protagonist',locked:false})
 for(let i=1;i<=5;i++)await db.storyboards.put({id:'conc-s'+i,projectId:id,sequence:i,characterIds:[],sceneText:'scene '+i,imagePrompt:'image '+i,videoPrompt:'move',durationSec:5,edit:{trimInSec:0,trimOutSec:5,entryState:'a',exitState:'b',cutNote:'c'},status:'pending'})
 let inflight=0,peak=0
 t.mock.method(globalThis,'fetch',async(url)=>{
  inflight++;peak=Math.max(peak,inflight)
  await new Promise(r=>setTimeout(r,15))
  inflight--
  if(String(url).includes('images'))return new Response(JSON.stringify({data:[{b64_json:Buffer.from('png').toString('base64')}]}),{headers:{'content-type':'application/json'}})
  return new Response('{"error":"stop here"}',{status:400,headers:{'content-type':'application/json'}})
 })
 const p={llm:{id:'llm',kind:'llm',model:'m',baseUrl:'https://example.invalid',apiKey:''},text2image:{id:'img',kind:'text2image',model:'img',baseUrl:'https://example.invalid',apiKey:''},image2video:{id:'vid',kind:'image2video',model:'vid',baseUrl:'https://example.invalid',apiKey:''}}
 await runPipeline(id,p)
 const prod=await db.productions.get(id)
 const ops=Object.entries(prod.automation.operations)
 assert.equal(ops.filter(([k])=>k.startsWith('image:')).length,5)
 assert.equal(prod.automation.submissions,ops.length)
 assert.ok(peak>=2,'requests ran concurrently')
 assert.equal(prod.automation.status,'failed')
 assert.equal((await db.storyboards.where('projectId').equals(id).toArray()).filter(s=>s.imageAssetId).length,5)
})

test('clip filtergraph burns PNG overlays and speeds up slightly long narration',{skip:!hasFfmpeg()},()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'clip-'))
 try{
  const run=args=>execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{cwd:dir})
  run(['-f','lavfi','-i','testsrc=size=640x360:rate=30','-t','5','-pix_fmt','yuv420p','in.mp4'])
  run(['-f','lavfi','-i','sine=frequency=440:sample_rate=24000','-t','5.6','voice.wav'])
  run(['-f','lavfi','-i','color=c=white@0.0:s=720x1280,format=rgba','-frames:v','1','cap.png'])
  writeFileSync(path.join(dir,'noop'),'')
  run(clipArgs({start:0,input:'in.mp4',voiceFile:'voice.wav',overlays:[{file:'cap.png',start:0,end:2.5},{file:'cap.png',start:2.5,end:4.6}],audioIn:'1:a',tempo:5.6/4.52,duration:4.6,width:720,height:1280,fps:25,output:'out.mp4'}))
  const probe=execFileSync('ffprobe',['-v','error','-show_entries','format=duration:stream=width,height,codec_type','-of','json','out.mp4'],{cwd:dir}).toString()
  const info=JSON.parse(probe)
  assert.ok(Math.abs(Number(info.format.duration)-4.6)<.1)
  assert.ok(info.streams.some(s=>s.codec_type==='video'&&s.width===720&&s.height===1280))
  assert.ok(info.streams.some(s=>s.codec_type==='audio'))
 }finally{rmSync(dir,{recursive:true,force:true})}
})
function hasFfmpeg(){try{execFileSync('ffmpeg',['-version']);return true}catch{return false}}

test('timing solver hits the exact target without asking the model to do arithmetic',async()=>{
 const {fitShotTiming,normalizeBeatSeconds,minShotSec}=await import('../src/core/pipeline/timing.ts')
 // The real failed draft: 14 shots, 4s each, 11–23 character lines, 5s/10s material.
 const lines=[17,15,11,21,18,15,15,21,21,16,15,20,12,23].map(n=>'字'.repeat(n))
 const r=fitShotTiming(lines.map(n=>({desiredSec:4,narration:n})),60,[5,10])
 assert.equal(r.ok,true)
 assert.equal(r.totalSec,60)
 r.shots.forEach((s,i)=>{assert.ok(s.trimOutSec>=minShotSec(lines[i],4.8)-0.04);assert.ok(s.trimOutSec<=s.materialSec);assert.ok([5,10].includes(s.materialSec))})
 // A 75-second draft is scaled down instead of rejected.
 const big=fitShotTiming(Array.from({length:15},()=>({desiredSec:5,narration:'短句'})),60,[5])
 assert.equal(big.ok,true);assert.equal(big.totalSec,60)
 // Too much dialogue gives a concrete, per-shot repair instruction.
 const over=fitShotTiming(Array.from({length:12},()=>({desiredSec:5,narration:'字'.repeat(24)})),60,[5])
 assert.equal(over.ok,false);assert.match(over.issues[0],/旁白/)
 const few=fitShotTiming([{desiredSec:5},{desiredSec:5}],60,[5])
 assert.equal(few.ok,false);assert.match(few.issues[0],/增加/)
 assert.deepEqual(normalizeBeatSeconds([12,10,10,10,10,8],60),[12,10,10,10,10,8])
 assert.equal(normalizeBeatSeconds([15,15,15,15,15],60).reduce((a,b)=>a+b),60)
})

test('resuming a storyboard that only failed on timing reuses the saved draft without a model request',async t=>{
 const {directShots}=await import('../src/core/pipeline/directing.ts')
 const id='resume-draft';await db.projects.put({id,title:'逆光'})
 const chars=[{id:'c1',projectId:id,name:'林',role:'protagonist',locked:false}]
 const shot=(i,n)=>({sequence:i,scene_text:'画面'+i,narration:'字'.repeat(n),image_prompt:'img',video_prompt:'move',character_names:['林'],duration_sec:5,direction:{scene:'s',purpose:'p',framing:'f',eyeline:'e',sound:'v',sourceExcerpt:'x'},edit:{trimInSec:0,trimOutSec:4,entryState:'a',exitState:'b',cutNote:'c'}})
 const previous={shots:[17,15,11,21,18,15,15,21,21,16,15,20,12,23].map((n,i)=>shot(i+1,n))}
 await db.productions.put({projectId:id,chapters:[{id:'c',title:'c',text:'x'}],selectedId:'c',plan:{}})
 const fetch=t.mock.method(globalThis,'fetch',async()=>{throw new Error('must not call the model')})
 await directShots({id:'l',kind:'llm',model:'m',baseUrl:'x',apiKey:''},{id:'v',kind:'image2video',model:'wan3.0-video',apiFlavor:'aliyun',baseUrl:'x',apiKey:''},await db.productions.get(id),{id,title:'逆光'},chars,{...defaultPreset,audio:'narration',durationSec:60},new AbortController().signal,{previous,issues:['镜头4：对白超出镜长容量']})
 assert.equal(fetch.mock.callCount(),0)
 const shots=await db.storyboards.where('projectId').equals(id).toArray()
 assert.equal(shots.length,14)
 assert.equal(Math.round(shots.reduce((a,s)=>a+(s.edit.trimOutSec-s.edit.trimInSec),0)*100)/100,60)
})

test('character consistency casts main characters once and draws every frame from their references',async t=>{
 const id='cast-test';await db.projects.put({id,title:'定妆'})
 await db.productions.put({projectId:id,chapters:[{id:'c',title:'c',text:'小说'}],selectedId:'c',plan:{logline:'',hook:'',ending:'',beats:[]},promptsReady:true,preset:{...defaultPreset,audio:'original',concurrency:2},automation:{...newAutomation(),submissions:0}})
 await db.characters.bulkPut([{id:'lin',projectId:id,name:'林',role:'protagonist',description:'短发白衬衫',locked:false},{id:'zhou',projectId:id,name:'周',role:'supporting',description:'黑西装',locked:false},{id:'x',projectId:id,name:'路人',role:'extra',locked:false}])
 const shot=(i,ids)=>({id:'cast-s'+i,projectId:id,sequence:i,characterIds:ids,sceneText:'s',imagePrompt:'林把信放在桌上',videoPrompt:'m',durationSec:5,edit:{trimInSec:0,trimOutSec:5},status:'pending'})
 await db.storyboards.bulkPut([shot(1,['lin']),shot(2,['lin','zhou']),shot(3,['x'])])
 const bodies=[]
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  const u=String(url)
  if(u.includes('multimodal-generation')){bodies.push(JSON.parse(init.body));return new Response(JSON.stringify({output:{choices:[{message:{content:[{image:'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a.png'}]}}]}}),{headers:{'content-type':'application/json'}})}
  if(u.includes('/media'))return new Response(new Uint8Array(500),{headers:{'content-type':'image/png'}})
  if(u.includes('images/generations'))return new Response(JSON.stringify({data:[{b64_json:Buffer.from('png').toString('base64')}]}),{headers:{'content-type':'application/json'}})
  return new Response('{"error":"stop"}',{status:400,headers:{'content-type':'application/json'}})
 })
 const p={llm:{id:'llm',kind:'llm',model:'m',baseUrl:'x',apiKey:''},text2image:{id:'img',kind:'text2image',model:'qwen-image-3.0',baseUrl:'https://ws1.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',apiKey:'sk'},image2video:{id:'vid',kind:'image2video',model:'vid',baseUrl:'https://example.invalid',apiKey:''}}
 await runPipeline(id,p)
 const chars=await db.characters.where('projectId').equals(id).toArray()
 assert.ok(chars.find(c=>c.id==='lin').referenceAssetId);assert.ok(chars.find(c=>c.id==='zhou').referenceAssetId)
 assert.equal(chars.find(c=>c.id==='x').referenceAssetId,undefined)
 const casting=bodies.filter(b=>b.input.messages[0].content.length===1)
 assert.equal(casting.length,2)
 const frame2=bodies.find(b=>b.input.messages[0].content.length===3)
 assert.ok(frame2,'two-character frame sends both references')
 assert.equal(frame2.model,'qwen-image-2.0')
 assert.match(frame2.input.messages[0].content[2].text,/参考图1是角色「林」.*参考图2是角色「周」/)
 assert.equal(frame2.parameters.size,'928*1664')
 const shots=await db.storyboards.where('projectId').equals(id).toArray()
 assert.equal(shots.filter(s=>s.imageAssetId).length,3)
})

test('Qwen-TTS retries rate limits and falls back from the workspace domain to the official route',async t=>{
 const calls=[];let n=0
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  const u=String(url);calls.push(u)
  if(u.startsWith('/api/aliyun'))return new Response(JSON.stringify({error:{message:'Model not supported in this workspace'}}),{status:400,headers:{'content-type':'application/json'}})
  if(u.includes('multimodal-generation')){n++;if(n===1)return new Response(JSON.stringify({code:'Throttling',message:'Requests rate limit exceeded'}),{status:429,headers:{'content-type':'application/json'}})
   return new Response(JSON.stringify({output:{audio:{url:'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a.wav'}}}),{headers:{'content-type':'application/json'}})}
  return new Response(new Uint8Array(2000),{headers:{'content-type':'audio/wav'}})
 })
 const blob=await generateTtsAudio({baseUrl:'https://ws1.cn-beijing.maas.aliyuncs.com',apiKey:'sk',model:'qwen3-tts-flash'},{model:'qwen3-tts-flash',text:'你好',voice:'Cherry'})
 assert.equal(blob.size,2000)
 assert.ok(calls[0].startsWith('/api/aliyun'))
 assert.equal(calls.filter(u=>u==='/api/bailian/api/v1/services/aigc/multimodal-generation/generation').length,2)
 // A hard rejection surfaces the provider's message instead of a bare "请求失败".
 t.mock.restoreAll()
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({error:{message:'voice not found'}}),{status:400,headers:{'content-type':'application/json'}}))
 await assert.rejects(generateTtsAudio({baseUrl:'/api/bailian',apiKey:'sk',model:'qwen3-tts-flash'},{model:'qwen3-tts-flash',text:'你好',voice:'X'}),/voice not found/)
})

test('storyboard v2: scenes, continuity chains and trims that let continuous shots join seamlessly',async t=>{
 const {directShots,normalizeContinuity}=await import('../src/core/pipeline/directing.ts')
 const {buildChains}=await import('../src/core/pipeline/runner.ts')
 const shot=(i,scene,cont,n=8)=>({sequence:i,scene_id:scene,continuity:cont,shot_size:'medium',scene_text:'画面'+i,narration:'字'.repeat(n),image_prompt:'img',video_prompt:'move',character_names:[],duration_sec:4,direction:{scene:scene},edit:{entryState:'a',exitState:'b',cutNote:'c'}})
 // continuity is normalised: first shot and scene changes are always cuts
 const drafts=[shot(1,'S1','continuous'),shot(2,'S1','continuous'),shot(3,'S2','continuous'),shot(4,'S2','cut')]
 normalizeContinuity(drafts)
 assert.deepEqual(drafts.map(s=>s.continuity),['cut','continuous','cut','cut'])
 assert.deepEqual(buildChains([{sceneId:'S1',continuity:'cut'},{sceneId:'S1',continuity:'continuous'},{sceneId:'S1',continuity:'continuous'},{sceneId:'S2',continuity:'cut'}]).map(c=>c.length),[3,1])
 const id='v2-test';await db.projects.put({id,title:'v2'})
 await db.productions.put({projectId:id,chapters:[{id:'c',title:'c',text:'x'}],selectedId:'c',plan:{}})
 const raw={scenes:[{id:'S1',name:'雨夜便利店',setting:'深夜便利店',lighting:'冷白顶光'}],shots:[shot(1,'S1','cut'),shot(2,'S1','continuous'),shot(3,'S1','continuous'),shot(4,'S1','cut')]}
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('no model call')})
 await directShots({id:'l',kind:'llm',model:'m',baseUrl:'x',apiKey:''},{id:'v',kind:'image2video',model:'wan2.2-i2v-flash',apiFlavor:'bailian',baseUrl:'x',apiKey:''},await db.productions.get(id),{id,title:'v2'},[],{...defaultPreset,format:'scene',durationSec:15,audio:'narration'},new AbortController().signal,{previous:raw,issues:[]})
 const shots=(await db.storyboards.where('projectId').equals(id).toArray()).sort((a,b)=>a.sequence-b.sequence)
 assert.equal(shots.length,4)
 const total=shots.reduce((a,s)=>a+(s.edit.trimOutSec-s.edit.trimInSec),0)
 assert.ok(Math.abs(total-15)<0.05,String(total))
 // shot 1 ends on its last frame (shot 2 starts from it); shot 2 is a chain middle: full clip
 assert.equal(shots[0].edit.trimOutSec,5)
 assert.equal(shots[1].edit.trimInSec,0);assert.equal(shots[1].edit.trimOutSec,5)
 assert.equal(shots[2].edit.trimInSec,0)
 assert.equal(shots[1].continuity,'continuous');assert.equal(shots[3].continuity,'cut')
 assert.equal((await db.productions.get(id)).scenes[0].name,'雨夜便利店')
})

test('graded clip filtergraph with scene-change fades renders at 1080x1920',{skip:!hasFfmpeg()},()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'grade-'))
 try{
  const run=args=>execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{cwd:dir})
  run(['-f','lavfi','-i','testsrc=size=1280x720:rate=24','-t','5','-pix_fmt','yuv420p','in.mp4'])
  run(clipArgs({start:0.24,input:'in.mp4',overlays:[],audioIn:'1:a',tempo:1,duration:3.2,width:1080,height:1920,fps:25,output:'out.mp4',fadeIn:true,fadeOut:true,grade:true}))
  const info=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration:stream=width,height,codec_type','-of','json','out.mp4'],{cwd:dir}).toString())
  assert.ok(info.streams.some(s=>s.codec_type==='video'&&s.width===1080&&s.height===1920))
  assert.ok(Math.abs(Number(info.format.duration)-3.2)<.1)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('dialogue mode: distinct voices per character, emotional delivery with fallback, ambient bed mix',async t=>{
 const {pickVoices}=await import('../src/core/pipeline/presets.ts')
 const v=pickVoices([{id:'a',gender:'female',age:'young'},{id:'b',gender:'male',age:'young'},{id:'c',gender:'female',age:'young'},{id:'d',gender:'male',age:'elder'}])
 assert.equal(new Set(Object.values(v)).size,4)
 assert.equal(v.d,'Eldric Sage')
 // instruct model first; a 4xx rejection falls back to the plain model without instructions
 const bodies=[]
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  const u=String(url)
  if(u.includes('multimodal-generation')){const b=JSON.parse(init.body);bodies.push(b)
   if(b.model==='qwen3-tts-instruct-flash')return new Response(JSON.stringify({code:'InvalidParameter',message:'model not supported'}),{status:400,headers:{'content-type':'application/json'}})
   return new Response(JSON.stringify({output:{audio:{url:'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a.wav'}}}),{headers:{'content-type':'application/json'}})}
  return new Response(new Uint8Array(3000),{headers:{'content-type':'audio/wav'}})
 })
 const blob=await generateTtsAudio({baseUrl:'/api/bailian',apiKey:'sk',model:'qwen3-tts-flash'},{model:'qwen3-tts-flash',text:'你再说一遍？',voice:'Ethan',instructions:'压着火气，一字一顿'})
 assert.equal(blob.size,3000)
 assert.equal(bodies[0].model,'qwen3-tts-instruct-flash');assert.equal(bodies[0].input.instructions,'压着火气，一字一顿')
 assert.equal(bodies[1].model,'qwen3-tts-flash');assert.equal(bodies[1].input.instructions,undefined)
})

test('dialogue clip mixes voice over a ducked ambient bed',{skip:!hasFfmpeg()},()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'bed-'))
 try{
  const run=args=>execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{cwd:dir})
  run(['-f','lavfi','-i','testsrc=size=720x1280:rate=24','-f','lavfi','-i','anoisesrc=d=5:c=pink','-t','5','-pix_fmt','yuv420p','-shortest','in.mp4'])
  run(['-f','lavfi','-i','sine=frequency=300:sample_rate=24000','-t','2','voice.wav'])
  run(clipArgs({start:0.24,input:'in.mp4',voiceFile:'voice.wav',overlays:[],audioIn:'1:a',tempo:1,duration:4,width:720,height:1280,fps:25,output:'out.mp4',grade:true,bed:true}))
  run(clipArgs({start:0,input:'in.mp4',overlays:[],audioIn:'0:a',tempo:1,duration:3,width:720,height:1280,fps:25,output:'amb.mp4',grade:true,ambientOnly:true}))
  for(const f of ['out.mp4','amb.mp4']){
   const info=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type','-of','json',f],{cwd:dir}).toString())
   assert.ok(info.streams.some(s=>s.codec_type==='audio'),f)
  }
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('lip sync: voice is uploaded and drives the wan2.6 video for on-screen speakers',async t=>{
 const id='lip-test';await db.projects.put({id,title:'口型'})
 await db.productions.put({projectId:id,chapters:[{id:'c',title:'c',text:'x'}],selectedId:'c',plan:{logline:'',hook:'',ending:'',beats:[]},promptsReady:true,preset:{...defaultPreset,audio:'dialogue',consistency:false,lipSync:true,concurrency:1},automation:{...newAutomation(),submissions:0}})
 await db.characters.put({id:'lin2',projectId:id,name:'林',role:'protagonist',locked:false,voice:'Serena'})
 await db.storyboards.bulkPut([
  {id:'lip-s1',projectId:id,sequence:1,characterIds:['lin2'],speaker:'林',narration:'你终于来了。',delivery:'压低声音',sceneText:'s',imagePrompt:'i',videoPrompt:'m',durationSec:5,edit:{trimInSec:0.24,trimOutSec:3.24},status:'pending'},
  {id:'lip-s2',projectId:id,sequence:2,characterIds:['lin2'],speaker:'旁白',narration:'那一年。',sceneText:'s',imagePrompt:'i',videoPrompt:'m',durationSec:5,edit:{trimInSec:0,trimOutSec:3},status:'pending'},
 ])
 const submits=[];let uploads=0
 t.mock.method(globalThis,'fetch',async(url,init={})=>{
  const u=String(url)
  if(u.startsWith('/api/bailian/upload')){uploads++;assert.match(u,/model=wan2\.6-i2v-flash/);return new Response(JSON.stringify({url:'oss://dashscope-instant/x/shot-1.wav'}),{headers:{'content-type':'application/json'}})}
  if(u.includes('multimodal-generation'))return new Response(JSON.stringify({output:{audio:{url:'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a.wav'}}}),{headers:{'content-type':'application/json'}})
  if(u.includes('/media'))return new Response(new Uint8Array(4000),{headers:{'content-type':'audio/wav'}})
  if(u.includes('images/generations'))return new Response(JSON.stringify({data:[{b64_json:Buffer.from('png').toString('base64')}]}),{headers:{'content-type':'application/json'}})
  if(u.includes('video-synthesis')){submits.push({body:JSON.parse(init.body),headers:new Headers(init.headers)});return new Response('{"message":"stop"}',{status:400,headers:{'content-type':'application/json'}})}
  return new Response('{}',{status:404,headers:{'content-type':'application/json'}})
 })
 const p={llm:{id:'llm',kind:'llm',model:'m',baseUrl:'x',apiKey:''},text2image:{id:'img',kind:'text2image',model:'img',baseUrl:'https://example.invalid',apiKey:''},image2video:{id:'vid',kind:'image2video',model:'wan3.0-video',baseUrl:'https://ws1.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',apiKey:'sk'},tts:{id:'tts',kind:'tts',model:'qwen3-tts-flash',baseUrl:'/api/bailian',apiKey:'sk',apiFlavor:'bailian'}}
 await runPipeline(id,p)
 assert.equal(uploads,1)
 const lip=submits.find(x=>x.body.model==='wan2.6-i2v-flash')
 assert.ok(lip,'speaker shot submitted to the lip-sync model')
 assert.equal(lip.body.input.audio_url,'oss://dashscope-instant/x/shot-1.wav')
 assert.equal(lip.headers.get('X-DashScope-OssResourceResolve'),'enable')
 // the rejected lip-sync submit falls back to the normal video model for that shot
 assert.ok(submits.some(x=>x.body.model==='wan3.0-video'))
})

test('final mix ducks background music under dialogue',{skip:!hasFfmpeg()},()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'bgm-'))
 try{
  const run=args=>execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{cwd:dir})
  run(['-f','lavfi','-i','testsrc=size=720x1280:rate=25','-f','lavfi','-i','sine=frequency=500:sample_rate=48000','-t','4','-pix_fmt','yuv420p','-c:a','aac','-shortest','mid_0.mp4'])
  run(['-f','lavfi','-i','sine=frequency=220:sample_rate=44100','-t','1.5','bgm.mp3'])
  writeFileSync(path.join(dir,'concat.txt'),"file 'mid_0.mp4'\nduration 4")
  run(finalArgs({total:4,fps:25,bgmFile:'bgm.mp3',bgmVolume:0.22,output:'out.mp4'}))
  const info=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type','-of','json','out.mp4'],{cwd:dir}).toString())
  assert.ok(Math.abs(Number(info.format.duration)-4)<0.15)
  assert.ok(info.streams.some(s=>s.codec_type==='audio'))
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('model settings from the settings page override legacy per-project model fields',()=>{
 const legacy=normalizePreset({...defaultPreset,ttsModel:'qwen-tts',referenceModel:'old-image',lipSyncModel:'old-lip'})
 const run=applyModelSettings(legacy,{tts:'qwen3-tts-instruct-flash',reference:'qwen-image-2.0',lipSync:'wan2.6-i2v-flash'})
 assert.equal(run.ttsModel,'qwen3-tts-instruct-flash');assert.equal(run.referenceModel,'qwen-image-2.0');assert.equal(run.lipSyncModel,'wan2.6-i2v-flash')
 assert.equal(applyModelSettings(legacy).ttsModel,'qwen-tts')
 assert.equal(applyModelSettings(legacy,{tts:' '}).ttsModel,'qwen-tts')
})
test('HappyHorse i2v sends the first frame as input.media without ratio or watermark',async t=>{
 const {createAliyunClient}=await import('../src/core/video/aliyun-client.ts')
 let body
 t.mock.method(globalThis,'fetch',async(url,options)=>{body=JSON.parse(options.body);return Response.json({output:{task_id:'t1'}})})
 const client=createAliyunClient({baseUrl:'https://llm-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',apiKey:'k',model:'happyhorse-1.1-i2v'})
 assert.equal((await client.submit({prompt:'p',imageBlob:new Blob(['abc'],{type:'image/png'}),durationSec:5,resolution:'480P'})).taskId,'t1')
 assert.deepEqual(body.input,{prompt:'p',media:[{type:'first_frame',url:'data:image/png;base64,YWJj'}]})
 assert.deepEqual(body.parameters,{resolution:'480P',duration:5,watermark:false})
})
test('wan2.7 i2v sends the first frame and lip-sync voice as input.media and never asks for 480P',async t=>{
 const {createAliyunClient}=await import('../src/core/video/aliyun-client.ts')
 let body
 t.mock.method(globalThis,'fetch',async(url,options)=>{body=JSON.parse(options.body);return Response.json({output:{task_id:'t1'}})})
 const client=createAliyunClient({baseUrl:'https://llm-example.cn-beijing.maas.aliyuncs.com',apiKey:'k',model:'wan2.7-i2v'})
 await client.submit({prompt:'p',imageBlob:new Blob(['abc'],{type:'image/png'}),durationSec:5,resolution:'480P',audioUrl:'oss://voice.wav'})
 assert.deepEqual(body.input.media,[{type:'first_frame',url:'data:image/png;base64,YWJj'},{type:'driving_audio',url:'oss://voice.wav'}])
 assert.equal(body.input.img_url,undefined)
 assert.equal(body.parameters.resolution,'720P')
 assert.equal(body.parameters.watermark,false)
})
test('a first-frame format rejection is resent once in the other format and remembered for that model',async t=>{
 const {createAliyunClient}=await import('../src/core/video/aliyun-client.ts')
 const store=new Map();Object.defineProperty(globalThis,'localStorage',{value:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v))},configurable:true,writable:true})
 t.after(()=>delete globalThis.localStorage)
 const bodies=[]
 t.mock.method(globalThis,'fetch',async(url,options)=>{const b=JSON.parse(options.body);bodies.push(b);return b.input.media?Response.json({output:{task_id:'t'+bodies.length}}):Response.json({code:'InvalidParameter',message:'Field required: input.media'},{status:400})})
 const client=createAliyunClient({baseUrl:'https://llm-example.cn-beijing.maas.aliyuncs.com',apiKey:'k',model:'future-i2v-9'})
 const req={prompt:'p',imageBlob:new Blob(['abc'],{type:'image/png'}),durationSec:5}
 assert.equal((await client.submit(req)).taskId,'t2')
 assert.ok(bodies[0].input.img_url&&bodies[1].input.media)
 assert.equal((await client.submit(req)).taskId,'t3')
 assert.equal(bodies.length,3,'the remembered format is used directly the next time')
})
test('other rejections are not resent, and a second format rejection stops instead of looping',async t=>{
 const {createAliyunClient}=await import('../src/core/video/aliyun-client.ts')
 const req={prompt:'p',imageBlob:new Blob(['abc'],{type:'image/png'}),durationSec:5}
 const client=createAliyunClient({baseUrl:'https://llm-example.cn-beijing.maas.aliyuncs.com',apiKey:'k',model:'wan2.2-i2v-flash'})
 const bad=t.mock.method(globalThis,'fetch',async()=>Response.json({code:'InvalidParameter',message:'The duration is invalid'},{status:400}))
 await assert.rejects(client.submit(req),/HTTP 400/);assert.equal(bad.mock.callCount(),1)
 bad.mock.restore()
 const both=t.mock.method(globalThis,'fetch',async(url,options)=>Response.json({message:JSON.parse(options.body).input.media?'Field required: input.img_url':'Field required: input.media'},{status:400}))
 await assert.rejects(client.submit(req),/HTTP 400/);assert.equal(both.mock.callCount(),2)
})
test('a task accepted and then failed for its first-frame field switches format for the retry',async t=>{
 const {createAliyunClient}=await import('../src/core/video/aliyun-client.ts')
 const store=new Map();Object.defineProperty(globalThis,'localStorage',{value:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v))},configurable:true,writable:true})
 t.after(()=>delete globalThis.localStorage)
 const bodies=[]
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(options?.method==='POST'){bodies.push(JSON.parse(options.body));return Response.json({output:{task_id:'t'+bodies.length}})}
  return Response.json({output:{task_status:'FAILED',message:'Field required: input.media'}})
 })
 const client=createAliyunClient({baseUrl:'https://llm-example.cn-beijing.maas.aliyuncs.com',apiKey:'k',model:'another-i2v-1'})
 const req={prompt:'p',imageBlob:new Blob(['abc'],{type:'image/png'}),durationSec:5}
 await client.submit(req)
 const status=await client.poll({taskId:'t1',apiFlavor:'aliyun'})
 assert.equal(status.kind,'failed');assert.match(status.message,/已改用 input\.media/)
 await client.submit(req)
 assert.ok(bodies[0].input.img_url&&bodies[1].input.media,'the retry uses the format the failed task asked for')
 assert.doesNotMatch((await client.poll({taskId:'t2',apiFlavor:'aliyun'})).message,/已改用/,'no flip-flop once already on that format')
})
test('continuing with a leftover task rejected for its first-frame field resubmits once in the current format',async t=>{
 const id='stale-test';await db.projects.put({id,title:'旧任务'})
 await db.productions.put({projectId:id,chapters:[{id:'c',title:'c',text:'小说'}],selectedId:'c',plan:{logline:'',hook:'',ending:'',beats:[]},promptsReady:true,preset:{...defaultPreset,audio:'original',maxSubmissions:50},automation:{...newAutomation(),submissions:3}})
 await db.characters.put({id:'stale-c',projectId:id,name:'A',role:'protagonist',locked:false})
 await db.assets.put({id:'stale-img',projectId:id,kind:'image',blob:new Blob(['png'],{type:'image/png'})})
 const ws='https://llm-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
 await db.storyboards.put({id:'stale-s1',projectId:id,sequence:1,characterIds:[],sceneText:'scene',imagePrompt:'image',videoPrompt:'move',durationSec:5,imageAssetId:'stale-img',status:'image-ready',edit:{trimInSec:0,trimOutSec:5,entryState:'a',exitState:'b',cutNote:'c'},pendingVideoTask:{taskId:'old-task',apiFlavor:'aliyun',submittedAt:1,providerId:'vid',baseUrl:ws,model:'happyhorse-1.1-i2v'}})
 const posts=[]
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(String(url).includes('images'))return Response.json({data:[{b64_json:Buffer.from('png').toString('base64')}]})
  if(options?.method==='POST'){posts.push(JSON.parse(options.body));return Response.json({output:{task_id:'new-task'}})}
  if(String(url).includes('/tasks/old-task'))return Response.json({output:{task_status:'FAILED',message:'Field required: input.media'}})
  return Response.json({output:{task_status:'FAILED',message:'stop here'}})
 })
 const p={llm:{id:'llm',kind:'llm',model:'m',baseUrl:'https://example.invalid',apiKey:''},text2image:{id:'img',kind:'text2image',model:'img',baseUrl:'https://example.invalid',apiKey:''},image2video:{id:'vid',kind:'image2video',model:'happyhorse-1.1-i2v',baseUrl:ws,apiKey:'k'}}
 await runPipeline(id,p)
 const videoPosts=posts.filter(b=>b.model==='happyhorse-1.1-i2v')
 assert.equal(videoPosts.length,1,'exactly one fresh submission')
 assert.ok(videoPosts[0].input.media,'submitted in the current (media) format')
 const prod=await db.productions.get(id)
 assert.equal(prod.automation.submissions,3+posts.length,'the fresh submission is counted')
 assert.match(prod.automation.error,/stop here/,'the old task is not polled again')
 assert.equal((await db.storyboards.get('stale-s1')).pendingVideoTask,undefined)
})
