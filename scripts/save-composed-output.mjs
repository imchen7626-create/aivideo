import {readFile,writeFile} from 'node:fs/promises'
const data=JSON.parse(await readFile(new URL('../local-data/database.json',import.meta.url),'utf8'))
const projectId=process.argv[2]
const used=new Set(data.storyboards.filter(s=>s.projectId===projectId).map(s=>s.videoAssetId))
const final=data.assets.filter(a=>a.projectId===projectId&&a.kind==='video'&&a.mimeType==='video/mp4'&&!used.has(a.id)).sort((a,b)=>b.createdAt-a.createdAt)[0]
if(!final)throw Error('No composed video was saved')
await writeFile(new URL('../outputs/好想和你谈恋爱_第1章_60秒.mp4',import.meta.url),Buffer.from(final.blobBase64,'base64'))
console.log('Saved composed MP4 from local project data')
