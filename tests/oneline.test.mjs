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
test('first frames start from the entry state and clips end on the exit state the next shot cuts on',async()=>{
 const {firstFramePrompt,shotMotionPrompt}=await import('../src/core/pipeline/continuity.ts')
 assert.match(firstFramePrompt('女孩站在海边','右手紧攥围巾流苏'),/动作开始之前.*右手紧攥围巾流苏[\s\S]*女孩站在海边/)
 assert.equal(firstFramePrompt('女孩站在海边','承接上一镜'),'女孩站在海边','placeholders are not real states')
 assert.equal(shotMotionPrompt('她松开手，围巾飞走','她侧身面向画面右侧'),'她松开手，围巾飞走。镜头结束时的画面：她侧身面向画面右侧。')
 assert.equal(shotMotionPrompt('她走路','动作完成'),'她走路')
})
test('a cut inside a scene draws its first frame after the previous one and uses it as a reference',async t=>{
 const id='prev-ref-test';await db.projects.put({id,title:'上一镜参考'})
 await db.productions.put({projectId:id,chapters:[{id:'c',title:'c',text:'小说'}],selectedId:'c',plan:{logline:'',hook:'',ending:'',beats:[]},promptsReady:true,scenes:[{id:'S1',name:'海边',setting:'傍晚沙滩',lighting:'落日'}],preset:{...defaultPreset,audio:'original',concurrency:3},automation:{...newAutomation(),submissions:0}})
 await db.characters.put({id:'girl',projectId:id,name:'女孩',role:'protagonist',description:'蓝围巾',locked:false})
 const shot=(i,entry)=>({id:'prev-s'+i,projectId:id,sequence:i,sceneId:'S1',continuity:'cut',characterIds:['girl'],sceneText:'s',imagePrompt:'女孩在海边 '+i,videoPrompt:'m',durationSec:5,edit:{trimInSec:0,trimOutSec:5,entryState:entry,exitState:'x'},status:'pending'})
 await db.storyboards.bulkPut([shot(1,'女孩迈步向前'),shot(2,'女孩停步，右手紧攥流苏')])
 const frames=[]
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  const u=String(url)
  if(u.includes('multimodal-generation')){const b=JSON.parse(init.body);const c=b.input.messages[0].content;if(c.length>1)frames.push(c);await new Promise(r=>setTimeout(r,c.length>1&&c.at(-1).text.includes('女孩在海边 1')?40:1));return Response.json({output:{choices:[{message:{content:[{image:'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a.png'}]}}]}})}
  if(u.includes('/media'))return new Response(new Uint8Array(500),{headers:{'content-type':'image/png'}})
  return new Response('{"error":"stop"}',{status:400,headers:{'content-type':'application/json'}})
 })
 const p={llm:{id:'llm',kind:'llm',model:'m',baseUrl:'x',apiKey:''},text2image:{id:'img',kind:'text2image',model:'qwen-image-3.0',baseUrl:'https://ws1.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',apiKey:'sk'},image2video:{id:'vid',kind:'image2video',model:'vid',baseUrl:'https://example.invalid',apiKey:''}}
 await runPipeline(id,p)
 assert.equal(frames.length,2)
 const [first,second]=frames
 assert.match(first.at(-1).text,/女孩在海边 1/,'shot 1 is drawn first even though shot 2 could start in parallel')
 assert.doesNotMatch(first.at(-1).text,/上一镜/)
 assert.match(second.at(-1).text,/上一镜（镜头1）的首帧画面/)
 assert.match(second.at(-1).text,/女孩停步，右手紧攥流苏/,'the entry state leads the first-frame prompt')
 assert.equal(second.length,4,'character + previous frame + scene plate + text')
})
test('HappyHorse and wan2.7 shots are generated close to their cut length, and surplus is trimmed from the head',async t=>{
 const {videoDurations}=await import('../src/core/pipeline/presets.ts')
 const {directShots}=await import('../src/core/pipeline/directing.ts')
 assert.deepEqual(videoDurations({id:'v',kind:'image2video',model:'happyhorse-1.1-i2v',baseUrl:'https://x.cn-beijing.maas.aliyuncs.com',apiKey:''}),[3,4,5,6,7,8])
 assert.deepEqual(videoDurations({id:'v',kind:'image2video',model:'wan2.7-i2v',apiFlavor:'aliyun',baseUrl:'x',apiKey:''}),[3,4,5,6,7,8])
 const shot=(i,d)=>({sequence:i,scene_id:'S1',continuity:'cut',shot_size:'medium',scene_text:'画面'+i,narration:'',image_prompt:'img',video_prompt:'move',character_names:[],duration_sec:d,direction:{scene:'S1'},edit:{entryState:'a'+i,exitState:'b'+i,cutNote:'c'}})
 const id='hh-timing';await db.projects.put({id,title:'时长'})
 await db.productions.put({projectId:id,chapters:[{id:'c',title:'c',text:'x'}],selectedId:'c',plan:{}})
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('no model call')})
 const raw={scenes:[{id:'S1',name:'海边',setting:'沙滩',lighting:'落日'}],shots:[shot(1,3.2),shot(2,4.1),shot(3,3.6),shot(4,4.1)]}
 await directShots({id:'l',kind:'llm',model:'m',baseUrl:'x',apiKey:''},{id:'v',kind:'image2video',model:'happyhorse-1.1-i2v',baseUrl:'https://x.cn-beijing.maas.aliyuncs.com',apiKey:''},await db.productions.get(id),{id,title:'时长'},[],{...defaultPreset,format:'scene',durationSec:15,audio:'original'},new AbortController().signal,{previous:raw,issues:[]})
 const shots=(await db.storyboards.where('projectId').equals(id).toArray()).sort((a,b)=>a.sequence-b.sequence)
 for(const s of shots){
  const used=s.edit.trimOutSec-s.edit.trimInSec,surplus=s.durationSec-used
  assert.ok(surplus<1.01,`shot ${s.sequence}: ${s.durationSec}s material for a ${used}s cut`)
  assert.ok(s.durationSec-s.edit.trimOutSec<=surplus*0.3+0.04,`shot ${s.sequence} keeps its ending`)
 }
 const {createAliyunClient}=await import('../src/core/video/aliyun-client.ts')
 const bodies=[];t.mock.method(globalThis,'fetch',async(url,o)=>{bodies.push(JSON.parse(o.body));return Response.json({output:{task_id:'t'}})})
 await createAliyunClient({baseUrl:'https://x.cn-beijing.maas.aliyuncs.com',apiKey:'k',model:'happyhorse-1.1-i2v'}).submit({prompt:'p',imageBlob:new Blob(['a'],{type:'image/png'}),durationSec:4})
 await createAliyunClient({baseUrl:'https://api.302ai.cn',apiKey:'k',model:'wan2.6-i2v-flash'}).submit({prompt:'p',imageBlob:new Blob(['a'],{type:'image/png'}),durationSec:5})
 assert.equal(bodies[0].parameters.duration,4)
 await createAliyunClient({baseUrl:'https://x.cn-beijing.maas.aliyuncs.com',apiKey:'k',model:'wan3.0-video-prime'}).submit({prompt:'p',imageBlob:new Blob(['a'],{type:'image/png'}),durationSec:6})
 await createAliyunClient({baseUrl:'https://x.cn-beijing.maas.aliyuncs.com',apiKey:'k',model:'wan3.0-video'}).submit({prompt:'p',imageBlob:new Blob(['a'],{type:'image/png'}),durationSec:1})
 assert.equal(bodies[2].parameters.duration,6,'wan3.0 is no longer rounded to 5 or 10 seconds')
 assert.equal(bodies[3].parameters.duration,2,'wan3.0 minimum is 2 seconds')
 // 1.8.14 paid run: the lip-sync model (3/4/5/10/15 s) was sent 5 s for a 6 s cut, and composing failed
 for(const d of [6,8,4])await createAliyunClient({baseUrl:'https://x.cn-beijing.maas.aliyuncs.com',apiKey:'k',model:'wan2.6-i2v-flash'}).submit({prompt:'p',imageBlob:new Blob(['a'],{type:'image/png'}),durationSec:d})
 assert.deepEqual(bodies.slice(4).map(b=>b.parameters.duration),[10,10,4],'fixed-length models round up to a clip that covers the cut')
 assert.equal(bodies[1].parameters.prompt_extend,false,'no prompt rewriting that adds unplanned action')
})
test('a non-JSON provider error still falls back instead of blaming the local service',async t=>{
 const okAudio=()=>Response.json({output:{audio:{data:Buffer.from('x'.repeat(100)).toString('base64')}}})
 const calls=[]
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  const model=JSON.parse(init.body).model;calls.push([String(url).startsWith('/api/aliyun')?'workspace':'official',model])
  // The workspace does not serve the instruct model and answers with a plain-text 404.
  if(model==='qwen3-tts-instruct-flash')return new Response('Not Found',{status:404,headers:{'content-type':'text/plain'}})
  return okAudio()
 })
 const blob=await generateTtsAudio({baseUrl:'https://ws1.cn-beijing.maas.aliyuncs.com',apiKey:'sk',model:'qwen3-tts-flash'},{model:'qwen3-tts-flash',text:'你好',voice:'Cherry',instructions:'压低声音'})
 assert.equal(blob.type,'audio/wav')
 assert.deepEqual(calls,[['workspace','qwen3-tts-instruct-flash'],['official','qwen3-tts-instruct-flash'],['workspace','qwen3-tts-flash']])
 // A gateway hiccup is retried; a 200 page that is not JSON really is the local server.
 t.mock.restoreAll();let n=0
 t.mock.method(globalThis,'fetch',async()=>++n===1?new Response('<html><body>503 Service Temporarily Unavailable</body></html>',{status:503,headers:{'content-type':'text/html'}}):okAudio())
 assert.ok(await generateTtsAudio({baseUrl:'/api/bailian',apiKey:'sk',model:'qwen3-tts-flash'},{model:'qwen3-tts-flash',text:'你好'}))
 assert.equal(n,2)
 t.mock.restoreAll()
 t.mock.method(globalThis,'fetch',async()=>new Response('<!doctype html><title>AI 短剧生产台</title>',{headers:{'content-type':'text/html'}}))
 await assert.rejects(generateTtsAudio({baseUrl:'/api/bailian',apiKey:'sk',model:'qwen3-tts-flash'},{model:'qwen3-tts-flash',text:'你好'}),/本地百炼服务未启动/)
 t.mock.restoreAll()
 t.mock.method(globalThis,'fetch',async()=>new Response('<html>502 Bad Gateway</html>',{status:502,headers:{'content-type':'text/html'}}))
 await assert.rejects(generateTtsAudio({baseUrl:'/api/bailian',apiKey:'sk',model:'qwen3-tts-flash'},{model:'qwen3-tts-flash',text:'你好'}),/HTTP 502：502 Bad Gateway/)
})
test('a point-of-view shot leaves its viewer out of the cast, and an empty shot gets no character references',async t=>{
 const {directShots}=await import('../src/core/pipeline/directing.ts')
 const id='pov-test';await db.projects.put({id,title:'主观镜头'})
 await db.productions.put({projectId:id,chapters:[{id:'c',title:'c',text:'x'}],selectedId:'c',plan:{}})
 const chars=[{id:'pov-a',projectId:id,name:'登山者',role:'protagonist'},{id:'pov-b',projectId:id,name:'向导',role:'supporting'}]
 await db.characters.bulkPut(chars)
 const shot=(i,extra)=>({sequence:i,scene_id:'S1',continuity:'cut',shot_size:'medium',scene_text:'画面'+i,narration:'',image_prompt:'img'+i,video_prompt:'move'+i,character_names:['登山者','向导'],duration_sec:5,direction:{scene:'S1'},edit:{entryState:'a',exitState:'b',cutNote:'c'},...extra})
 const raw={scenes:[{id:'S1',name:'峰顶',setting:'岩石峰顶',lighting:'斜阳'}],shots:[shot(1),shot(2,{pov_of:'登山者',image_prompt:'望远镜圆形视野里，向导在远处山脊上挥手'}),shot(3,{image_prompt:'远山黑云翻涌，无人物'})]}
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('no model call')})
 await directShots({id:'l',kind:'llm',model:'m',baseUrl:'x',apiKey:''},{id:'v',kind:'image2video',model:'happyhorse-1.1-i2v',baseUrl:'https://x.cn-beijing.maas.aliyuncs.com',apiKey:''},await db.productions.get(id),{id,title:'主观镜头'},chars,{...defaultPreset,format:'scene',durationSec:15,audio:'original'},new AbortController().signal,{previous:raw,issues:[]})
 const shots=(await db.storyboards.where('projectId').equals(id).toArray()).sort((a,b)=>a.sequence-b.sequence)
 assert.deepEqual(shots[0].characterIds,['pov-a','pov-b'])
 assert.deepEqual(shots[1].characterIds,['pov-b'],'the viewer is not in his own point of view')
 assert.match(shots[1].imagePrompt,/^这是登山者的主观视角.*登山者本人不出现在画面中/)
 assert.match(shots[1].videoPrompt,/登山者本人不出现在画面中/)
 assert.deepEqual(shots[2].characterIds,[],'nobody on screen, no costume references')
})
test('frames with nobody on screen or a point of view are drawn without the people who are not in them',async t=>{
 const id='pov-ref-test';await db.projects.put({id,title:'主观参考'})
 await db.productions.put({projectId:id,chapters:[{id:'c',title:'c',text:'小说'}],selectedId:'c',plan:{logline:'',hook:'',ending:'',beats:[]},promptsReady:true,scenes:[{id:'S1',name:'峰顶',setting:'岩石',lighting:'斜阳'}],preset:{...defaultPreset,audio:'original',concurrency:1},automation:{...newAutomation(),submissions:0}})
 await db.characters.bulkPut([{id:'climber',projectId:id,name:'登山者',role:'protagonist',locked:false},{id:'guide',projectId:id,name:'向导',role:'supporting',locked:false}])
 const shot=(i,img,ids)=>({id:'pr-s'+i,projectId:id,sequence:i,sceneId:'S1',continuity:'cut',characterIds:ids,sceneText:'s',imagePrompt:img,videoPrompt:'m',durationSec:5,edit:{trimInSec:0,trimOutSec:5},status:'pending'})
 await db.storyboards.bulkPut([shot(1,'登山者举起望远镜',['climber']),shot(2,'望远镜圆形视野，远处山脊黑云翻涌，无人物面部',['climber']),shot(3,'这是登山者的主观视角：画面是登山者看到的景象，登山者本人不出现在画面中（最多露出手或望远镜等器物的边缘）。向导在山脊上挥手',['guide'])])
 const frames=[]
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  const u=String(url)
  if(u.includes('multimodal-generation')){const c=JSON.parse(init.body).input.messages[0].content;if(c.length>1||/镜头|望远镜/.test(c.at(-1).text))frames.push(c);return Response.json({output:{choices:[{message:{content:[{image:'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a.png'}]}}]}})}
  if(u.includes('/media'))return new Response(new Uint8Array(500),{headers:{'content-type':'image/png'}})
  return new Response('{"error":"stop"}',{status:400,headers:{'content-type':'application/json'}})
 })
 const p={llm:{id:'llm',kind:'llm',model:'m',baseUrl:'x',apiKey:''},text2image:{id:'img',kind:'text2image',model:'qwen-image-3.0',baseUrl:'https://ws1.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',apiKey:'sk'},image2video:{id:'vid',kind:'image2video',model:'vid',baseUrl:'https://example.invalid',apiKey:''}}
 await runPipeline(id,p)
 const text=n=>frames.find(c=>c.at(-1).text.includes(n)).at(-1).text
 assert.doesNotMatch(text('黑云翻涌'),/外观参考图|上一镜/,'empty shot: only the scene plate')
 assert.match(text('向导在山脊'),/角色「向导」的外观参考图/,'other characters in a point of view keep their reference')
 assert.doesNotMatch(text('向导在山脊'),/登山者」的外观参考图|上一镜/,'the viewer is not painted in')
 const {castingPrompt,referencePrompt}=await import('../src/core/image/reference.ts')
 assert.match(referencePrompt('跑',[{name:'甲',kind:'character'}]),/不照搬参考图的正面全身站姿/)
})
test('requests to edit an existing video are recognised before anything is generated',async()=>{
 const {referencesExistingVideo}=await import('../src/core/pipeline/request-hints.ts')
 assert.ok(referencesExistingVideo('把火星哥的upstwon的MV中的火星哥换成86版西游记中唐僧生成片段,别的不用动'))
 assert.ok(referencesExistingVideo('电影泰坦尼克号船头那段，男主角换成孙悟空，其他保持不变'))
 for(const own of ['在陡峭的山坡上，一个穿登山服的年轻人登顶远眺，镜头围绕他旋转','被全公司嘲笑的保洁阿姨，其实是集团失踪多年的董事长','她把旧车票换成了一张新的'])assert.equal(referencesExistingVideo(own),false,own)
})
test('a scene film is planned faithfully from the description, without drama hooks or twists',async t=>{
 const {directPlan}=await import('../src/core/pipeline/directing.ts')
 const prompts=[]
 t.mock.method(globalThis,'fetch',async(url,init)=>{prompts.push(JSON.parse(init.body).messages[0].content);return new Response('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify({logline:'登顶',hook:'h',ending:'e',beats:[{title:'登顶',description:'d',durationSec:8},{title:'环绕',description:'d',durationSec:7}]})}}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}})})
 const llm={id:'llm',kind:'llm',model:'m',baseUrl:'https://example.invalid',apiKey:''}
 await directPlan(llm,{id:'scene',title:'场景',text:'登山者登顶远眺，镜头围绕他旋转'},{id:'p',title:'t'},[],{...defaultPreset,format:'scene',durationSec:15},new AbortController().signal)
 await directPlan(llm,{id:'c',title:'第一章',text:'小说'},{id:'p',title:'t'},[],{...defaultPreset,format:'drama',durationSec:15},new AbortController().signal)
 const [scene,drama]=prompts
 assert.match(scene,/忠实拍出/);assert.match(scene,/不新增用户没写的情节/);assert.match(scene,/环绕/)
 assert.doesNotMatch(scene,/中段至少一次反转|明确开场钩子/,'no drama twists forced onto a described scene')
 assert.match(drama,/明确开场钩子、冲突、升级、反转和结尾/)
})
test('a storyboard-timed scene film takes as long as its shots need instead of a fixed total',async t=>{
 const {fitShotTiming,minShotSec}=await import('../src/core/pipeline/timing.ts')
 const {normalizePreset,storyboardTimed}=await import('../src/core/pipeline/presets.ts')
 const {directPlan,directShots}=await import('../src/core/pipeline/directing.ts')
 assert.equal(normalizePreset({format:'scene',durationMode:'storyboard'}).durationMode,'storyboard')
 assert.equal(normalizePreset({durationMode:'bogus'}).durationMode,'fixed')
 assert.equal(storyboardTimed(normalizePreset({format:'drama',durationMode:'storyboard'})),false,'a drama keeps its fixed length')
 // Free timing: each shot keeps its own length (clamped to what its line needs and the model can make).
 const free=fitShotTiming([{desiredSec:3.2},{desiredSec:12},{desiredSec:1,narration:'字'.repeat(16)},{desiredSec:6,exact:true}],undefined,[5,10])
 assert.equal(free.ok,true)
 assert.deepEqual(free.shots.map(x=>x.trimOutSec),[3.2,10,Math.ceil(minShotSec('字'.repeat(16))*25)/25,10])
 assert.deepEqual(free.shots.map(x=>x.materialSec),[5,10,5,10])
 assert.equal(free.totalSec,free.shots.reduce((n,x)=>n+x.trimOutSec,0))
 assert.equal(fitShotTiming([{narration:'字'.repeat(60)}],undefined,[5]).ok,false,'a line longer than any clip still asks for a split')
 // The plan is not asked for (or rescaled to) a total.
 const prompts=[]
 t.mock.method(globalThis,'fetch',async(url,init)=>{prompts.push(JSON.parse(init.body).messages[0].content);return new Response('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify({logline:'早餐',hook:'h',ending:'e',beats:[{title:'起床',description:'d',durationSec:8},{title:'做饭',description:'d',durationSec:13}]})}}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}})})
 const llm={id:'llm',kind:'llm',model:'m',baseUrl:'https://example.invalid',apiKey:''}
 const preset={...defaultPreset,format:'scene',durationSec:60,durationMode:'storyboard',audio:'original'}
 const plan=await directPlan(llm,{id:'scene',title:'场景',text:'她起床后去厨房做早餐'},{id:'p',title:'t'},[],preset,new AbortController().signal)
 assert.deepEqual(plan.beats.map(b=>b.durationSec),[8,13],'natural beat lengths are kept')
 assert.doesNotMatch(prompts[0],/60秒|时长合计/);assert.match(prompts[0],/总时长由内容决定/)
 // Shots are cut to their own lengths; nothing is stretched to 60 seconds.
 const shot=(i,d,c='cut')=>({sequence:i,scene_id:'S1',continuity:c,shot_size:'medium',scene_text:'画面'+i,narration:'',image_prompt:'img',video_prompt:'move',character_names:[],duration_sec:d,direction:{scene:'S1'},edit:{entryState:'a'+i,exitState:'b'+i,cutNote:'c'}})
 const id='free-timing';await db.projects.put({id,title:id})
 await db.productions.put({projectId:id,chapters:[{id:'c',title:'c',text:'她起床后去厨房做早餐'}],selectedId:'c',plan})
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('no model call')})
 const raw={scenes:[{id:'S1',name:'卧室',setting:'卧室',lighting:'晨光'}],shots:[shot(1,3.2),shot(2,6),shot(3,4.4)]}
 await directShots(llm,{id:'v',kind:'image2video',model:'wan3.0-video-prime',apiFlavor:'aliyun',baseUrl:'https://x.cn-beijing.maas.aliyuncs.com',apiKey:''},await db.productions.get(id),{id,title:id},[],preset,new AbortController().signal,{previous:raw,issues:[]})
 const shots=(await db.storyboards.where('projectId').equals(id).toArray()).sort((a,b)=>a.sequence-b.sequence)
 assert.deepEqual(shots.map(s=>Math.round((s.edit.trimOutSec-s.edit.trimInSec)*100)/100),[3.2,6,4.4])
 assert.deepEqual(shots.map(s=>s.durationSec),[4,6,5],'wan3.0 material is generated to the whole second that covers each cut')
})
test('a video model typed into the voice setting is stopped before anything is paid for',async()=>{
 const {preflight,applyModelSettings,deriveBailianTts,modelFits}=await import('../src/core/pipeline/presets.ts')
 const ws={id:'v',kind:'image2video',model:'wan3.0-video-prime',baseUrl:'https://ws.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',apiKey:'k'}
 const providers={llm:{id:'l',kind:'llm',model:'qwen3.8-flash',baseUrl:'https://ws.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',apiKey:'k'},text2image:{...ws,id:'i',kind:'text2image',model:'qwen-image-3.0'},image2video:ws,tts:deriveBailianTts([ws])}
 const run=models=>preflight(applyModelSettings({...defaultPreset,audio:'dialogue'},models),providers).join('；')
 assert.match(run({tts:'wan3.0-video'}),/配音模型「wan3.0-video」不是语音模型/)
 assert.match(run({reference:'wan3.0-video'}),/角色一致性出图模型「wan3.0-video」不是图像模型/)
 assert.match(run({lipSync:'qwen3-tts-flash'}),/口型同步视频模型「qwen3-tts-flash」不是视频模型/)
 assert.doesNotMatch(run({tts:'auto',reference:'qwen-image-3.0',lipSync:'wan2.7-i2v'}),/不是/)
 assert.doesNotMatch(run({tts:'qwen3-tts-instruct-flash'}),/不是/)
 assert.ok(modelFits('tts','cosyvoice-v3')&&!modelFits('tts','wan3.0-video'))
})
test('a rate-limited reference image or video submit waits and resends instead of failing the shot',async t=>{
 const {generateWithReferences}=await import('../src/core/image/reference.ts')
 const {createAliyunClient}=await import('../src/core/video/aliyun-client.ts')
 const calls=[]
 t.mock.method(globalThis,'fetch',async url=>{
  calls.push(String(url))
  if(String(url).includes('/media?'))return new Response(new Blob(['png'],{type:'image/png'}))
  if(calls.length===1)return Response.json({code:'Throttling.RateQuota',message:'Requests rate limit exceeded'},{status:429})
  return Response.json({output:{choices:[{message:{content:[{image:'https://x.oss-cn-beijing.aliyuncs.com/a.png'}]}}]}})
 })
 const img=await generateWithReferences({baseUrl:'https://ws.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',apiKey:'k',model:'qwen-image-3.0'},{prompt:'p',references:[],size:'928*1664'})
 assert.equal(img.type,'image/png');assert.equal(calls.filter(u=>u.includes('multimodal-generation')).length,2,'one resend after the 429')
 let submits=0
 t.mock.method(globalThis,'fetch',async()=>++submits===1?Response.json({code:'Throttling'},{status:429}):Response.json({output:{task_id:'t1'}}))
 const handle=await createAliyunClient({baseUrl:'https://x.cn-beijing.maas.aliyuncs.com',apiKey:'k',model:'wan3.0-video-prime'}).submit({prompt:'p',imageBlob:new Blob(['a'],{type:'image/png'}),durationSec:4})
 assert.equal(handle.taskId,'t1');assert.equal(submits,2)
})
test('characters in a Chinese story are drawn as Chinese unless the story says otherwise',async()=>{
 const {withDefaultEthnicity,namesEthnicity}=await import('../src/core/pipeline/request-hints.ts')
 const story='某一天阳光明媚的早上，在卧室中，女朋友躺在床上还没睡醒，我在厨房煎爱心鸡蛋'
 assert.match(withDefaultEthnicity('年龄感24至28岁；脸型偏长方，深棕短发',story),/^中国人，东亚面孔；/)
 assert.equal(withDefaultEthnicity('金发碧眼的美国女孩，雀斑',story),'金发碧眼的美国女孩，雀斑')
 assert.equal(withDefaultEthnicity('短发',"巴黎街头一位法国老人"),'短发','the story names where people are from')
 assert.equal(withDefaultEthnicity('short hair','A rainy morning in London, she wakes up late'),'short hair')
 assert.ok(namesEthnicity('东亚面孔')&&!namesEthnicity('鹅蛋脸，杏眼'))
})
test('a pose jump between neighbouring shots is sent back once, and a repaired draft is not failed on it alone',async t=>{
 const {postureJumps,directShots,ShotPlanError}=await import('../src/core/pipeline/directing.ts')
 const names=['男朋友','女朋友']
 // shots 5 → 6 of the 1.8.12 paid run: she was still lying down, then already sat on the bed edge
 const shot=(i,entry,exit,video,cast=names)=>({sequence:i,scene_id:'S1',continuity:'cut',shot_size:'medium',scene_text:'s'+i,narration:'',image_prompt:'img'+i,video_prompt:video,character_names:cast,duration_sec:4,direction:{scene:'S1'},edit:{entryState:entry,exitState:exit,cutNote:'c'}})
 const five=shot(5,'男朋友站在床边微笑，女朋友仍闭眼躺着','男朋友俯身靠近床边，女朋友听到后睫毛微动','男朋友保持微笑，身体向床边轻轻俯近')
 const six=shot(6,'女朋友半坐在床上，眼睛半闭，身体未靠肩','女朋友闭眼趴在男朋友肩上','女朋友慢慢坐直，向男朋友肩膀靠过去')
 const issues=postureJumps([five,six],names)
 assert.equal(issues.length,1);assert.match(issues[0],/镜头2：「女朋友」上一镜结束时躺着，本镜开头却已坐着/)
 // the sit-up is acted in the earlier shot: no jump
 const sitUp=shot(5,'女朋友闭眼躺着','女朋友坐起来，揉着眼睛','女朋友慢慢坐起来')
 assert.deepEqual(postureJumps([sitUp,six],names),[])
 // a different place, or someone not in the earlier shot, is not compared
 assert.deepEqual(postureJumps([five,{...six,scene_id:'S2'}],names),[])
 assert.deepEqual(postureJumps([shot(1,'女朋友躺着','x','y',['女朋友']),shot(2,'男朋友站在门口','x','y',['男朋友'])],names),[])
 // directShots: a first draft with the jump is rejected with that instruction …
 const id='posture';await db.projects.put({id,title:id})
 await db.productions.put({projectId:id,chapters:[{id:'c',title:'c',text:'她醒来'}],selectedId:'c',plan:{beats:[]}})
 const chars=names.map((name,k)=>({id:'pc'+k,projectId:id,name,role:'protagonist',description:'d'}))
 const raw={scenes:[{id:'S1',name:'卧室',setting:'卧室',lighting:'晨光'}],shots:[{...five,sequence:1},{...six,sequence:2}]}
 const reply=()=>new Response('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify(raw)}}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}})
 let calls=0
 t.mock.method(globalThis,'fetch',async()=>{calls++;return reply()})
 const llm={id:'l',kind:'llm',model:'m',baseUrl:'https://example.invalid',apiKey:''}
 const video={id:'v',kind:'image2video',model:'wan3.0-video-prime',apiFlavor:'aliyun',baseUrl:'https://x.cn-beijing.maas.aliyuncs.com',apiKey:''}
 const preset={...defaultPreset,format:'scene',durationMode:'storyboard',audio:'original'}
 const err=await directShots(llm,video,await db.productions.get(id),{id,title:id},chars,preset,new AbortController().signal).catch(e=>e)
 assert.ok(err instanceof ShotPlanError);assert.match(err.message,/中间的动作没拍出来/)
 // … and the repair pass asks the model once more, then keeps its answer
 await directShots(llm,video,await db.productions.get(id),{id,title:id},chars,preset,new AbortController().signal,err.repair)
 assert.equal(calls,2)
 assert.equal(await db.storyboards.where('projectId').equals(id).count(),2)
})
const pcmWav=(sec,rate=24000)=>{const data=Math.round(sec*rate)*2,b=Buffer.alloc(44+data);b.write('RIFF',0);b.writeUInt32LE(36+data,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(data,40);for(let i=44;i<b.length;i+=2)b.writeInt16LE(1000,i);return new Uint8Array(b)}
test('short lines are padded with silence to the lip-sync minimum, and an audio rejection falls back to normal video',async t=>{
 const {wavDurationSec,padWavToMinDuration,lipSyncMinAudioSec}=await import('../src/core/composition/wav.ts')
 const short=pcmWav(1.2)
 assert.ok(Math.abs(wavDurationSec(short)-1.2)<0.001)
 const padded=padWavToMinDuration(short,lipSyncMinAudioSec('wan2.6-i2v-flash'))
 assert.ok(wavDurationSec(padded)>=3.1,'wan2.6 needs at least 3s of driving audio')
 assert.deepEqual(padded.subarray(44,44+short.length-44),short.subarray(44),'the spoken part is unchanged')
 assert.equal(new DataView(padded.buffer).getUint32(4,true),padded.length-8,'RIFF size updated')
 assert.ok(lipSyncMinAudioSec('wan2.7-i2v')<lipSyncMinAudioSec('wan2.6-i2v-flash'))
 assert.equal(padWavToMinDuration(pcmWav(4),3.1).length,pcmWav(4).length,'long lines untouched')
 const notWav=new Uint8Array([1,2,3]);assert.equal(padWavToMinDuration(notWav,3),notWav)
 // end to end: the uploaded voice is padded; if the model still rejects the audio, the shot renders normally
 const id='lip-pad-test';await db.projects.put({id,title:'短台词'})
 await db.productions.put({projectId:id,chapters:[{id:'c',title:'c',text:'x'}],selectedId:'c',plan:{logline:'',hook:'',ending:'',beats:[]},promptsReady:true,preset:{...defaultPreset,audio:'dialogue',consistency:false,lipSync:true,concurrency:1},automation:{...newAutomation(),submissions:0}})
 await db.characters.put({id:'pad-c',projectId:id,name:'少年',role:'protagonist',locked:false,voice:'Ethan'})
 await db.storyboards.put({id:'pad-s1',projectId:id,sequence:1,characterIds:['pad-c'],speaker:'少年',narration:'跑吗？',sceneText:'s',imagePrompt:'i',videoPrompt:'m',durationSec:5,edit:{trimInSec:0,trimOutSec:4},status:'pending'})
 let uploaded;const submits=[]
 t.mock.method(globalThis,'fetch',async(url,init={})=>{
  const u=String(url)
  if(u.startsWith('/api/bailian/upload')){uploaded=new Uint8Array(await init.body.arrayBuffer());return Response.json({url:'oss://dashscope-instant/x/shot-1.wav'})}
  if(u.includes('multimodal-generation'))return Response.json({output:{audio:{data:Buffer.from(pcmWav(1.2)).toString('base64')}}})
  if(u.includes('images/generations'))return Response.json({data:[{b64_json:Buffer.from('png').toString('base64')}]})
  if(u.includes('video-synthesis')){const body=JSON.parse(init.body);submits.push(body.model);return body.model==='wan2.6-i2v-flash'?Response.json({output:{task_id:'lip-task'}}):new Response('{"message":"stop"}',{status:400,headers:{'content-type':'application/json'}})}
  if(u.includes('/tasks/lip-task'))return Response.json({output:{task_status:'FAILED',message:'audio duration is out of range'}})
  return new Response('{}',{status:404,headers:{'content-type':'application/json'}})
 })
 const p={llm:{id:'llm',kind:'llm',model:'m',baseUrl:'x',apiKey:''},text2image:{id:'img',kind:'text2image',model:'img',baseUrl:'https://example.invalid',apiKey:''},image2video:{id:'vid',kind:'image2video',model:'wan3.0-video-prime',baseUrl:'https://ws1.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',apiKey:'sk'},tts:{id:'tts',kind:'tts',model:'qwen3-tts-flash',baseUrl:'/api/bailian',apiKey:'sk',apiFlavor:'bailian'}}
 await runPipeline(id,p)
 assert.ok(wavDurationSec(uploaded)>=3.1,'the uploaded driving audio meets the model minimum')
 assert.deepEqual(submits,['wan2.6-i2v-flash','wan3.0-video-prime'],'audio rejection falls back to the normal video model')
 assert.equal((await db.storyboards.get('pad-s1')).pendingVideoTask,undefined)
})
test('a model without the chosen resolution gets one it supports, and the lip-sync shot is resubmitted with its voice',async t=>{
 const {createAliyunClient,resolutionFromRejection}=await import('../src/core/video/aliyun-client.ts')
 const store=new Map();Object.defineProperty(globalThis,'localStorage',{value:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v))},configurable:true,writable:true})
 t.after(()=>delete globalThis.localStorage)
 assert.equal(resolutionFromRejection("resolution 480P is not supported, available ones are ['720P', '1080P']"),'720P')
 assert.equal(resolutionFromRejection('stop'),undefined)
 const ws='https://ws1.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
 const req={prompt:'p',imageBlob:new Blob(['abc'],{type:'image/png'}),durationSec:5,resolution:'480P'}
 // a known model is sent a resolution it has
 let bodies=[];t.mock.method(globalThis,'fetch',async(u,o)=>{bodies.push(JSON.parse(o.body));return Response.json({output:{task_id:'t'}})})
 await createAliyunClient({baseUrl:ws,apiKey:'k',model:'wan2.6-i2v-flash'}).submit(req)
 assert.equal(bodies[0].parameters.resolution,'720P')
 // an unknown model is corrected once from its error, then remembered
 t.mock.restoreAll();bodies=[]
 t.mock.method(globalThis,'fetch',async(u,o)=>{const b=JSON.parse(o.body);bodies.push(b);return b.parameters.resolution==='480P'?Response.json({message:"resolution 480P is not supported, available ones are ['720P', '1080P']"},{status:400}):Response.json({output:{task_id:'t'+bodies.length}})})
 const other=createAliyunClient({baseUrl:ws,apiKey:'k',model:'wan2.5-i2v-preview'})
 assert.equal((await other.submit(req)).taskId,'t2');await other.submit(req)
 assert.deepEqual(bodies.map(b=>b.parameters.resolution),['480P','720P','720P'])
 t.mock.restoreAll();store.clear()
 // end to end: a lip-sync task accepted and then failed for resolution is resubmitted, still lip-synced
 const id='res-test';await db.projects.put({id,title:'分辨率'})
 await db.productions.put({projectId:id,chapters:[{id:'c',title:'c',text:'x'}],selectedId:'c',plan:{logline:'',hook:'',ending:'',beats:[]},promptsReady:true,preset:{...defaultPreset,audio:'dialogue',consistency:false,lipSync:true,concurrency:1,resolution:'480P'},automation:{...newAutomation(),submissions:0}})
 await db.characters.put({id:'res-c',projectId:id,name:'少年',role:'protagonist',locked:false,voice:'Ethan'})
 await db.storyboards.put({id:'res-s1',projectId:id,sequence:1,characterIds:['res-c'],speaker:'少年',narration:'这一球我来投。',sceneText:'s',imagePrompt:'i',videoPrompt:'m',durationSec:5,edit:{trimInSec:0,trimOutSec:4},status:'pending'})
 const submits=[]
 t.mock.method(globalThis,'fetch',async(url,init={})=>{
  const u=String(url)
  if(u.startsWith('/api/bailian/upload'))return Response.json({url:'oss://dashscope-instant/x/shot-1.wav'})
  if(u.includes('multimodal-generation'))return Response.json({output:{audio:{data:Buffer.from(pcmWav(3.5)).toString('base64')}}})
  if(u.includes('images/generations'))return Response.json({data:[{b64_json:Buffer.from('png').toString('base64')}]})
  if(u.includes('video-synthesis')){const b=JSON.parse(init.body);submits.push(b);return b.parameters.resolution==='720P'?new Response('{"message":"stop"}',{status:400,headers:{'content-type':'application/json'}}):Response.json({output:{task_id:'lip-480'}})}
  if(u.includes('/tasks/lip-480'))return Response.json({output:{task_status:'FAILED',message:"resolution 480P is not supported, available ones are ['720P', '1080P']"}})
  return new Response('{}',{status:404,headers:{'content-type':'application/json'}})
 })
 const p={llm:{id:'llm',kind:'llm',model:'m',baseUrl:'x',apiKey:''},text2image:{id:'img',kind:'text2image',model:'img',baseUrl:'https://example.invalid',apiKey:''},image2video:{id:'vid',kind:'image2video',model:'wan3.0-video-prime',baseUrl:ws,apiKey:'sk'},tts:{id:'tts',kind:'tts',model:'qwen3-tts-flash',baseUrl:'/api/bailian',apiKey:'sk',apiFlavor:'bailian'}}
 await runPipeline(id,p,{tts:'auto',reference:'qwen-image-2.0',lipSync:'wan2.5-i2v-preview'})
 assert.deepEqual(submits.map(b=>[b.model,b.parameters.resolution,!!b.input.audio_url]),[['wan2.5-i2v-preview','480P',true],['wan2.5-i2v-preview','720P',true]],'resubmitted once at a supported resolution, still driven by the voice')
})
test('a scene film without dialogue in the description gets no invented lines (so no lip-sync model switch)',async t=>{
 const {hasDialogue}=await import('../src/core/pipeline/request-hints.ts')
 const {directShots}=await import('../src/core/pipeline/directing.ts')
 const {firstFramePrompt}=await import('../src/core/pipeline/continuity.ts')
 assert.equal(hasDialogue('一个阳光少年,在篮球场跳起扣篮,扣篮成功后嚣张庆祝的场景,场边的美女在加油助威'),false)
 for(const s of ['她喊：“太帅了！”','少年说：这一球我来','两人有一段对白'])assert.ok(hasDialogue(s),s)
 assert.match(firstFramePrompt('少年捶胸并指向场边','少年落地转身，准备捶胸'),/姿势与道具状态只按这一句：少年落地转身，准备捶胸。.*下文写到的动作、手势和结果此刻都还没有发生/)
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('no model call')})
 const shot=(i)=>({sequence:i,scene_id:'S1',continuity:'cut',shot_size:'medium',scene_text:'画面'+i,speaker:'少年',narration:'漂亮！',delivery:'得意',image_prompt:'img',video_prompt:'move',character_names:['少年'],duration_sec:5,direction:{scene:'S1'},edit:{entryState:'a',exitState:'b',cutNote:'c'}})
 const raw={scenes:[{id:'S1',name:'球场',setting:'室外篮球场',lighting:'午后'}],shots:[shot(1),shot(2),shot(3)]}
 const chars=[{id:'dl-boy',name:'少年',role:'protagonist'}]
 const run=async(id,text,audio)=>{await db.projects.put({id,title:id});await db.productions.put({projectId:id,chapters:[{id:'scene',title:'场景',text}],selectedId:'scene',plan:{}})
  await directShots({id:'l',kind:'llm',model:'m',baseUrl:'x',apiKey:''},{id:'v',kind:'image2video',model:'wan3.0-video-prime',baseUrl:'https://x.cn-beijing.maas.aliyuncs.com',apiKey:''},await db.productions.get(id),{id,title:id},chars,{...defaultPreset,format:'scene',durationSec:15,audio},new AbortController().signal,{previous:structuredClone(raw),issues:[]})
  return (await db.storyboards.where('projectId').equals(id).toArray()).map(s=>[s.speaker??'',s.narration??''])}
 assert.deepEqual(await run('dl-1','少年扣篮后嚣张庆祝，场边美女加油助威','dialogue'),[['',''],['',''],['','']],'no lines were written, none are kept')
 assert.deepEqual((await run('dl-2','少年扣篮后大喊：“漂亮！”','dialogue'))[0],['少年','漂亮！'],'written dialogue is kept')
 assert.deepEqual((await run('dl-3','少年扣篮后嚣张庆祝','narration'))[0][1],'漂亮！','a chosen voice-over is kept')
})
test('image prompts never mention makeup or red cheeks, and flushed-face phrases are dropped from descriptions',async()=>{
 const {castingPrompt,referencePrompt,withoutFlushedFace}=await import('../src/core/image/reference.ts')
 // descriptions taken from real projects whose costume references came out with red cheek patches
 assert.equal(withoutFlushedFace('长发微卷，肤色白净被海风吹出淡淡红晕，穿米白长裙'),'长发微卷，穿米白长裙')
 assert.equal(withoutFlushedFace('男性，约20岁，手腕缠着一条褪色的红绳（林薇三年前编的），短发。情绪波动大，眼眶发红，指节发白。'),'男性，约20岁，手腕缠着一条褪色的红绳（林薇三年前编的），短发。情绪波动大，指节发白。')
 assert.equal(withoutFlushedFace('鼻梁挺直，鼻梁与两颊有淡淡晒红，眉毛浓'),'鼻梁挺直，眉毛浓')
 for(const keep of ['外披一件朱红色锦襕袈裟','本场服装：鲜艳的橙红色冲锋衣','肤色健康的小麦色','面料为深红色丝绒'])assert.equal(withoutFlushedFace(keep),keep,keep)
 const cast=castingPrompt({name:'少年',description:'肤色白净，两颊泛红，穿橙色球衣'},'电影写实')
 assert.doesNotMatch(cast,/定妆|腮红|红晕|泛红|红色色块/,'nothing that reads as makeup or red cheeks')
 assert.match(cast,/素颜/);assert.match(cast,/橙色球衣/)
 const shot=referencePrompt('少年扣篮',[{name:'少年',kind:'character'},{name:'球场',kind:'scene',label:'场景「球场」的定场图'}])
 assert.doesNotMatch(shot,/定妆|腮红/);assert.match(shot,/素颜/)
})
test('a pasted script is adapted as written, and the one-line writer keeps the user premise as a hard constraint',async()=>{
 const {looksLikeScript}=await import('../src/core/pipeline/request-hints.ts')
 const {ONE_LINE_STORY_RULES}=await import('../src/core/prompts/production-skills.ts')
 assert.equal(looksLikeScript('我和女朋友在清晨的卧室里吵架，最后和好'),false)
 assert.ok(looksLikeScript('镜头1：清晨卧室，我站在床边。\n镜头2：女朋友翻身醒来。'))
 assert.ok(looksLikeScript('第一镜 中景，女友在厨房煮咖啡，我从背后抱住她'))
 assert.ok(looksLikeScript('清晨'.repeat(120)),'long text is a script, not a one-line idea')
 assert.match(ONE_LINE_STORY_RULES,/硬约束/)
 assert.match(ONE_LINE_STORY_RULES,/不得新增用户没提到的主要人物或身份设定（如分身、克隆、替身、第三者/)
 assert.doesNotMatch(ONE_LINE_STORY_RULES,/自行补全题材、人物（2–4个有名字的角色）/)
})
test('a silent text model stops with a readable reason, a slow but streaming one is not cut off',async t=>{
 const {productionJson,LLM_IDLE_MS}=await import('../src/core/pipeline/production.ts')
 const enc=new TextEncoder(),line=s=>enc.encode('data: '+JSON.stringify({choices:[{delta:{content:s}}]})+'\n\n')
 t.mock.timers.enable({apis:['setTimeout']})
 // silent after the first chunk
 t.mock.method(globalThis,'fetch',async(url,init)=>new Response(new ReadableStream({start(c){c.enqueue(line('{"a":'));init.signal.addEventListener('abort',()=>c.error(new DOMException('BodyStreamBuffer was aborted','AbortError')))}}),{headers:{'Content-Type':'text/event-stream'}}))
 const llm={id:'llm',kind:'llm',model:'deepseek-chat',baseUrl:'https://example.invalid',apiKey:''}
 const silent=productionJson(llm,'写分镜','原文')
 for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r))
 t.mock.timers.tick(LLM_IDLE_MS)
 await assert.rejects(silent,/deepseek-chat）连续 120 秒没有输出，已中断。已完成的步骤都保留/)
 // a reply that keeps streaming past the old 5-minute limit finishes
 t.mock.restoreAll();t.mock.timers.reset();t.mock.timers.enable({apis:['setTimeout']})
 let push
 t.mock.method(globalThis,'fetch',async()=>new Response(new ReadableStream({start(c){push=c}}),{headers:{'Content-Type':'text/event-stream'}}))
 const slow=productionJson(llm,'写分镜','原文')
 for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r))
 const parts=['{"shots"',':[',']','}']
 for(const part of parts){t.mock.timers.tick(LLM_IDLE_MS-1000);push.enqueue(line(part));for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r))}
 push.enqueue(enc.encode('data: [DONE]\n\n'));push.close()
 assert.deepEqual(await slow,{shots:[]})
})
test('a thinking model is not cut off while it reasons, and its reasoning never enters the answer',async t=>{
 const {productionJson,LLM_IDLE_MS,LLM_FIRST_OUTPUT_MS}=await import('../src/core/pipeline/production.ts')
 const enc=new TextEncoder(),frame=d=>enc.encode('data: '+JSON.stringify({choices:[{delta:d}]})+'\n\n')
 const llm={id:'llm',kind:'llm',model:'qwen3.8-flash',baseUrl:'https://example.invalid',apiKey:''}
 const settle=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r))}
 t.mock.timers.enable({apis:['setTimeout']})
 let push;t.mock.method(globalThis,'fetch',async()=>new Response(new ReadableStream({start(c){push=c}}),{headers:{'Content-Type':'text/event-stream'}}))
 const progress=[]
 const done=productionJson(llm,'写分镜','原文',(p)=>progress.push(p.detail))
 await settle()
 // three minutes of reasoning only, a chunk every 90 seconds
 for(let i=0;i<2;i++){t.mock.timers.tick(90_000);push.enqueue(frame({reasoning_content:'先拆场次，再拆镜头。'}));await settle()}
 t.mock.timers.tick(LLM_IDLE_MS-1000)
 push.enqueue(frame({content:'{"shots":[]}'}));push.enqueue(enc.encode('data: [DONE]\n\n'));push.close()
 assert.deepEqual(await done,{shots:[]},'reasoning is not part of the JSON answer')
 assert.ok(progress.some(d=>/模型正在思考/.test(d)),'the user sees that the model is thinking')
 // a model that never starts gets the first-output allowance and a clear reason
 t.mock.restoreAll();t.mock.timers.reset();t.mock.timers.enable({apis:['setTimeout']})
 t.mock.method(globalThis,'fetch',async(url,init)=>new Response(new ReadableStream({start(c){init.signal.addEventListener('abort',()=>c.error(new DOMException('aborted','AbortError')))}}),{headers:{'Content-Type':'text/event-stream'}}))
 const never=productionJson(llm,'写分镜','原文')
 let settled=false;never.catch(()=>{}).finally(()=>{settled=true})
 await settle()
 t.mock.timers.tick(LLM_IDLE_MS)
 await settle()
 assert.equal(settled,false,'still waiting at 2 minutes: the first output may take longer')
 t.mock.timers.tick(LLM_FIRST_OUTPUT_MS-LLM_IDLE_MS)
 await assert.rejects(never,/qwen3\.8-flash）5 分钟内没有开始输出/)
})
test('a scene film keeps its locations apart, continuous chains stay short, and every frame restates the look',async t=>{
 const {normalizeContinuity,directShots}=await import('../src/core/pipeline/directing.ts')
 const {appearanceAnchor}=await import('../src/core/image/reference.ts')
 const d=(i,scene,cont)=>({sequence:i,scene_id:scene,continuity:cont})
 const chain=[d(1,'S1','cut'),d(2,'S1','continuous'),d(3,'S1','continuous'),d(4,'S1','continuous'),d(5,'S1','continuous')]
 normalizeContinuity(chain)
 assert.deepEqual(chain.map(s=>s.continuity),['cut','continuous','continuous','cut','continuous'],'at most one cut plus two continuous shots per chain')
 // the girlfriend from the bedroom film: hair and clothes are restated, the face is left to the reference
 const anchor=appearanceAnchor([{name:'女朋友',description:'二十多岁年轻女性，鹅蛋脸，眉形柔和，杏眼，肤色白皙偏暖。深棕色长发自然微卷，起床时披散在肩头。身材纤细匀称。本场服装为浅杏色棉质吊带睡裙，外搭米白色薄款针织开衫，赤足，不穿鞋。饰物为一条细银项链和一只简单发圈。'}])
 assert.match(anchor,/女朋友：深棕色长发自然微卷.*浅杏色棉质吊带睡裙.*米白色薄款针织开衫/)
 assert.doesNotMatch(anchor,/鹅蛋脸|杏眼/)
 // the scene-film instruction splits places and asks for close-ups of the named actions
 let instruction=''
 t.mock.method(globalThis,'fetch',async(url,init)=>{instruction=JSON.parse(init.body).messages[0].content;const shots=[1,2,3,4,5,6].map(i=>({sequence:i,scene_id:i<3?'S1':'S2',continuity:'cut',shot_size:'medium',scene_text:'画面'+i,narration:'',image_prompt:'img',video_prompt:'move',character_names:[],duration_sec:5,direction:{scene:'S'},edit:{entryState:'a',exitState:'b',cutNote:'c'}}));return new Response('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify({scenes:[{id:'S1',name:'卧室',setting:'卧室',lighting:'晨光'},{id:'S2',name:'厨房',setting:'厨房',lighting:'晨光'}],shots})}}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}})})
 const id='loc-test';await db.projects.put({id,title:id});await db.productions.put({projectId:id,chapters:[{id:'scene',title:'场景',text:'卧室里她还在睡。镜头一转，我在厨房煎爱心蛋。'}],selectedId:'scene',plan:{}})
 await directShots({id:'l',kind:'llm',model:'m',baseUrl:'https://example.invalid',apiKey:''},{id:'v',kind:'image2video',model:'wan3.0-video-prime',apiFlavor:'aliyun',baseUrl:'https://x.cn-beijing.maas.aliyuncs.com',apiKey:''},await db.productions.get(id),{id,title:id},[],{...defaultPreset,format:'scene',durationSec:30,audio:'original'},new AbortController().signal)
 assert.match(instruction,/每个地点一个场次（如卧室S1、厨房S2）.*不要把不同地点合成同一个空间/)
 assert.match(instruction,/关键动作和道具.*近景或特写/)
 assert.match(instruction,/换场次（换地点或时间跳跃）时，entryState写新地点里此刻的状态/)
 assert.doesNotMatch(instruction,/scenes只有一个S1/)
 assert.deepEqual([...new Set((await db.storyboards.where('projectId').equals(id).toArray()).map(s=>s.sceneId))].sort(),['S1','S2'])
})
test('costume references carry no props, a return to a place reuses its last frame, and clips are single takes',async t=>{
 const {castingPrompt,appearanceAnchor,withoutProps}=await import('../src/core/image/reference.ts')
 // the boyfriend from the paid test run: his reference photo held the breakfast plate in every shot
 const me='约二十多岁年轻男性，方圆脸，短碎发，深棕色；本场穿浅灰蓝色棉质衬衫，袖口挽起，搭配米白色针织围裙和深卡其休闲裤；脚穿灰色室内拖鞋；饰物为简约手表，随身道具为早餐盘中的烤面包与爱心煎蛋。性格目标：温柔哄起床。'
 assert.doesNotMatch(withoutProps(me),/早餐盘|烤面包|煎蛋/)
 const cast=castingPrompt({name:'我',description:me},'写实')
 assert.doesNotMatch(cast,/早餐盘|烤面包|煎蛋/);assert.match(cast,/手里不拿任何东西/);assert.match(cast,/米白色针织围裙/)
 const anchor=appearanceAnchor([{name:'我',description:me}])
 assert.doesNotMatch(anchor,/面包|煎蛋|道具/,'"面包" is not a bag');assert.match(anchor,/浅灰蓝色棉质衬衫/)
 // bedroom → kitchen → bedroom: the third shot is drawn from the first one's frame
 const id='return-test';await db.projects.put({id,title:'回到卧室'})
 await db.productions.put({projectId:id,chapters:[{id:'c',title:'c',text:'x'}],selectedId:'c',plan:{logline:'',hook:'',ending:'',beats:[]},promptsReady:true,scenes:[{id:'S1',name:'卧室',setting:'卧室',lighting:'晨光'},{id:'S2',name:'厨房',setting:'厨房',lighting:'晨光'}],preset:{...defaultPreset,audio:'original',concurrency:3},automation:{...newAutomation(),submissions:0}})
 await db.characters.put({id:'ret-g',projectId:id,name:'女友',role:'protagonist',description:'长直发，粉色开衫',locked:false})
 const shot=(i,scene,img)=>({id:'ret-s'+i,projectId:id,sequence:i,sceneId:scene,continuity:'cut',characterIds:scene==='S1'?['ret-g']:[],sceneText:'s',imagePrompt:img,videoPrompt:'move '+i,durationSec:5,edit:{trimInSec:0,trimOutSec:5,entryState:'e'+i,exitState:'x'},status:'pending'})
 await db.storyboards.bulkPut([shot(1,'S1','卧室里女友躺在床上'),shot(2,'S2','厨房灶台'),shot(3,'S1','女友在床上睁眼')])
 const frames=[],videos=[]
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  const u=String(url)
  if(u.includes('multimodal-generation')){const c=JSON.parse(init.body).input.messages[0].content;if(c.length>1)frames.push(c.at(-1).text);return Response.json({output:{choices:[{message:{content:[{image:'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a.png'}]}}]}})}
  if(u.includes('/media'))return new Response(new Uint8Array(500),{headers:{'content-type':'image/png'}})
  if(u.includes('video-synthesis')){videos.push(JSON.parse(init.body).input.prompt);return new Response('{"message":"stop"}',{status:400,headers:{'content-type':'application/json'}})}
  return new Response('{}',{status:404,headers:{'content-type':'application/json'}})
 })
 const ws='https://ws1.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
 await runPipeline(id,{llm:{id:'llm',kind:'llm',model:'m',baseUrl:'x',apiKey:''},text2image:{id:'img',kind:'text2image',model:'qwen-image-3.0',baseUrl:ws,apiKey:'sk'},image2video:{id:'vid',kind:'image2video',model:'wan3.0-video-prime',baseUrl:ws,apiKey:'sk'}})
 const back=frames.find(f=>f.includes('女友在床上睁眼'))
 assert.match(back,/上一镜（镜头1）的首帧画面/,'the bedroom shot after the kitchen is drawn from the earlier bedroom frame')
 assert.ok(videos.length&&videos.every(p=>/一镜到底的单一连续镜头，中途不切换镜头、不转场、不叠化/.test(p)))
 // from the 1.8.12 paid run: the phone insert floated up to the lens, and the actors smiled into the camera
 assert.match(videos.find(p=>p.includes('move 2')),/不被拿起、不漂浮、不飞向镜头/,'a prop insert moves the camera, not the prop')
 assert.match(videos.find(p=>p.includes('move 1')),/不看镜头/);assert.doesNotMatch(videos.find(p=>p.includes('move 1')),/不漂浮/)
 assert.match(back,/视线落在动作对象或画面里的另一人身上，不看镜头/)
 assert.ok(videos.every(p=>/不凭空出现首帧里没有的人、家具或物品/.test(p)),'no props or rooms invented off the first frame')
})
test('a scene film keeps only the user lines, never asks for slow speech, and an over-long acted take is redone at normal pace',async t=>{
 const {lineFromSource,withoutSlowPace}=await import('../src/core/pipeline/request-hints.ts')
 const src='镜头一转,我笑着走到卧室,在女朋友旁边轻声说道:宝贝,起床吃早饭啦,太阳晒屁股咯\n女朋友坐起来,她趴在我的肩膀懒懒的说:太困啦,不想起床.\n我说:今天做了爱心煎蛋嗷,今天天气很棒,出去透透气,给宝贝买漂亮的衣服好不好'
 assert.ok(lineFromSource('宝贝，起床吃早饭啦，太阳晒屁股咯。',src))
 assert.ok(lineFromSource('今天做了爱心煎蛋嗷，今天天气很棒，出去透透气，给宝贝买漂亮的衣服好不好。',src))
 assert.equal(lineFromSource('太阳晒屁股咯，她赖床不肯起。',src),false,'an added voice-over from the paid run is not the user line')
 assert.equal(withoutSlowPace('轻快温柔，像晨间提醒，语速偏慢'),'轻快温柔，像晨间提醒')
 assert.equal(withoutSlowPace('慵懒撒娇，声音软，语速慢'),'慵懒撒娇，声音软')
 // an acted take that runs past the shot is redone once without directions; a lip-synced one is left alone
 const id='retake-test';await db.projects.put({id,title:id})
 await db.productions.put({projectId:id,chapters:[{id:'c',title:'c',text:'x'}],selectedId:'c',plan:{logline:'',hook:'',ending:'',beats:[]},promptsReady:true,preset:{...defaultPreset,audio:'dialogue',consistency:false,lipSync:false,concurrency:1},automation:{...newAutomation(),submissions:0}})
 await db.characters.put({id:'retake-c',projectId:id,name:'女友',role:'protagonist',locked:false})
 await db.storyboards.put({id:'retake-s1',projectId:id,sequence:1,characterIds:[],speaker:'旁白',narration:'太阳晒屁股咯。',delivery:'温柔',sceneText:'s',imagePrompt:'i',videoPrompt:'m',durationSec:5,edit:{trimInSec:0,trimOutSec:3.8},status:'pending'})
 const tts=[]
 t.mock.method(globalThis,'fetch',async(url,init={})=>{
  const u=String(url)
  if(u.includes('multimodal-generation')){const b=JSON.parse(init.body);tts.push(!!b.input.instructions);return Response.json({output:{audio:{data:Buffer.from(pcmWav(b.input.instructions?8:3)).toString('base64')}}})}
  if(u.includes('images/generations'))return Response.json({data:[{b64_json:Buffer.from('png').toString('base64')}]})
  return new Response('{"message":"stop"}',{status:400,headers:{'content-type':'application/json'}})
 })
 const p={llm:{id:'llm',kind:'llm',model:'m',baseUrl:'x',apiKey:''},text2image:{id:'img',kind:'text2image',model:'img',baseUrl:'https://example.invalid',apiKey:''},image2video:{id:'vid',kind:'image2video',model:'vid',baseUrl:'https://example.invalid',apiKey:''},tts:{id:'tts',kind:'tts',model:'qwen3-tts-instruct-flash',baseUrl:'/api/bailian',apiKey:'sk',apiFlavor:'bailian'}}
 await runPipeline(id,p)
 assert.deepEqual(tts,[true,false],'acted take, then one plain retake')
 const {wavDurationSec}=await import('../src/core/composition/wav.ts')
 const saved=await db.storyboards.get('retake-s1');const a=await db.assets.get(saved.audioAssetId)
 assert.ok(Math.abs(wavDurationSec(new Uint8Array(await a.blob.arrayBuffer()))-3)<0.01,'the edit gets the take that fits')
 // a second run accepts the plain take instead of going back to the acted one
 await db.productions.update(id,{automation:{...newAutomation(),status:'queued'}});await runPipeline(id,p)
 assert.deepEqual(tts,[true,false],'no further voice requests')
 // a lip-synced shot keeps the take its mouth was animated to
 await db.storyboards.update('retake-s1',{lipSynced:true,audioFingerprint:'x'})
 await db.productions.update(id,{automation:{...newAutomation(),status:'queued'}});await runPipeline(id,p)
 assert.deepEqual(tts,[true,false,true],'regenerated once for the changed fingerprint, but not retaken while lip-synced')
})
test('a prop close-up is drawn from the scene plate, not copied from the previous wide frame',async t=>{
 const id='insert-test';await db.projects.put({id,title:id})
 await db.productions.put({projectId:id,chapters:[{id:'c',title:'c',text:'x'}],selectedId:'c',plan:{logline:'',hook:'',ending:'',beats:[]},promptsReady:true,scenes:[{id:'S1',name:'卧室',setting:'卧室',lighting:'晨光'}],preset:{...defaultPreset,audio:'original',concurrency:2},automation:{...newAutomation(),submissions:0}})
 await db.characters.put({id:'ins-g',projectId:id,name:'女友',role:'protagonist',description:'卷发',locked:false})
 const shot=(i,ids,img)=>({id:'ins-s'+i,projectId:id,sequence:i,sceneId:'S1',continuity:'cut',characterIds:ids,sceneText:'s',imagePrompt:img,videoPrompt:'m',durationSec:5,edit:{trimInSec:0,trimOutSec:5},status:'pending'})
 await db.storyboards.bulkPut([shot(1,['ins-g'],'女友躺在床上'),shot(2,[],'床头柜上手机锁屏合影特写'),shot(3,['ins-g'],'女友睁眼')])
 const frames=[]
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  const u=String(url)
  if(u.includes('multimodal-generation')){const c=JSON.parse(init.body).input.messages[0].content;if(c.length>1)frames.push(c.at(-1).text);return Response.json({output:{choices:[{message:{content:[{image:'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a.png'}]}}]}})}
  if(u.includes('/media'))return new Response(new Uint8Array(500),{headers:{'content-type':'image/png'}})
  return new Response('{"message":"stop"}',{status:400,headers:{'content-type':'application/json'}})
 })
 const ws='https://ws1.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
 await runPipeline(id,{llm:{id:'llm',kind:'llm',model:'m',baseUrl:'x',apiKey:''},text2image:{id:'img',kind:'text2image',model:'qwen-image-3.0',baseUrl:ws,apiKey:'sk'},image2video:{id:'vid',kind:'image2video',model:'vid',baseUrl:'https://example.invalid',apiKey:''}})
 const insert=frames.find(f=>f.includes('手机锁屏合影特写'))
 assert.ok(insert,'the close-up still gets the scene plate');assert.doesNotMatch(insert,/上一镜/)
 assert.match(frames.find(f=>f.includes('女友睁眼')),/上一镜（镜头1）的首帧画面/,'people shots refer to the last frame with people at this place, skipping the close-up')
})
