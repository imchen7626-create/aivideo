import {test} from 'node:test'
import assert from 'node:assert/strict'
import {registerHooks} from 'node:module'
import {existsSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
registerHooks({resolve(s,c,next){const u=s.startsWith('@/')?new URL('../src/'+s.slice(2),import.meta.url):s.startsWith('.')?new URL(s,c.parentURL):null;if(u?.protocol==='file:'&&existsSync(fileURLToPath(u)+'.ts'))return next(u.href+'.ts',c);return next(s,c)}})
const {buildEditTimeline,readEditScript}=await import('../src/core/composition/plan.ts')
const {buildSrt}=await import('../src/core/composition/subtitles.ts')
const {parseMediaInfo}=await import('../src/core/composition/concat.ts')
const make=(i,edit)=>({id:'s'+i,projectId:'p',sequence:i,sceneText:'scene'+i,videoAssetId:'v'+i,durationSec:5,narration:'镜头'+i,characterIds:[],status:'video-ready',edit})
test('editing uses shot order and media in/out points, and subtitles share the edited timeline',()=>{
 const shots=[make(2,{trimInSec:1,trimOutSec:4.2}),make(1,{trimInSec:.4,trimOutSec:4.6})]
 const plan=buildEditTimeline(shots)
 assert.deepEqual(plan.clips.map(s=>[s.sequence,s.timelineInSec,s.timelineOutSec]),[[1,0,4.2],[2,4.2,7.4]])
 assert.equal(plan.durationSec,7.4)
 assert.match(buildSrt(shots.sort((a,b)=>a.sequence-b.sequence)),/00:00:04,200 --> 00:00:07,400/)
})
test('missing, pending, duplicate and invalid clips cannot silently produce a partial final',()=>{
 assert.throws(()=>buildEditTimeline([make(1),{...make(2),videoAssetId:undefined}]),/尚未就绪/)
 assert.throws(()=>buildEditTimeline([{...make(1),pendingVideoTask:{taskId:'t'}}]),/尚未就绪/)
 assert.throws(()=>buildEditTimeline([make(1),make(1)]),/重复/)
 assert.throws(()=>buildEditTimeline([make(1,{trimInSec:3,trimOutSec:2})]),/无效/)
 assert.throws(()=>buildEditTimeline([make(1,{trimInSec:NaN,trimOutSec:5})]),/无效/)
})
test('changing footage, cuts, order or story invalidates a previous composed record',()=>{
 const shot=make(1),before=buildEditTimeline([shot]).fingerprint
 for(const change of [{videoAssetId:'new'}, {sceneText:'new story'}, {edit:{trimInSec:0,trimOutSec:4}}, {edit:{trimInSec:0,trimOutSec:5,cutNote:'new cut'}}, {sequence:2}])assert.notEqual(buildEditTimeline([{...shot,...change}]).fingerprint,before)
})
test('an imported episode updates editing only and rejects overlap or mismatched shot counts',()=>{
 const raw={episodes:[{shots:[{trim_in:.2,trim_out:4.6,cut_to_next:'match hand'}]}]}
 assert.deepEqual(readEditScript(raw,[make(1)])[0],{shotId:'s1',edit:{trimInSec:.2,trimOutSec:4.6,cutNote:'match hand',entryState:undefined,exitState:undefined}})
 assert.throws(()=>readEditScript(raw,[make(1),make(2)]),/逐一对应/)
 assert.throws(()=>readEditScript({shots:[{trim_in:0,trim_out:5,transition_overlap:.2}]},[make(1)]),/重叠/)
})
test('media inspection identifies actual duration, geometry and audio instead of guessing',()=>{
 const base='Duration: 00:01:00.02, start: 0.000000, bitrate: 2000 kb/s\nStream #0:0: Video: h264 (High), yuv420p, 720x1280 [SAR 1:1 DAR 9:16], 25 fps'
 assert.deepEqual(parseMediaInfo(base),{durationSec:60.02,width:720,height:1280,hasAudio:false})
 assert.equal(parseMediaInfo(base+'\nStream #0:1: Audio: aac, 48000 Hz, stereo').hasAudio,true)
 assert.throws(()=>parseMediaInfo('Invalid data found'),/没有可读取/)
})
