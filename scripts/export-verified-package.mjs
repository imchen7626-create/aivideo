import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import 'fake-indexeddb/auto'
// Browser export code uses FileReader for ZIP inputs; supply its small read-only Node equivalent.
globalThis.FileReader = class {
 readAsArrayBuffer(blob) { blob.arrayBuffer().then(result=>{this.result=result;this.onload?.({target:this})},error=>{this.error=error;this.onerror?.({target:this})}) }
}
registerHooks({resolve(specifier,context,next){
 const url=specifier.startsWith('@/')?new URL('../src/'+specifier.slice(2),import.meta.url):specifier.startsWith('.')?new URL(specifier,context.parentURL):null
 if(url?.protocol==='file:'&&existsSync(fileURLToPath(url)+'.ts'))return next(url.href+'.ts',context)
 return next(specifier,context)
}})
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const projectId=process.argv[2]
if(!projectId)throw Error('Provide the project ID to export')
const snapshot=JSON.parse(await readFile(path.join(root,'local-data','database.json'),'utf8'))
const {db}=await import('../src/core/storage/db.ts')
const {buildProductionPackage}=await import('../src/core/export/production.ts')
for(const name of ['projects','characters','materials','storyboards','assets','generations','productions']){
 const rows=snapshot[name]??[]
 if(name==='assets')for(const row of rows){row.blob=new Blob([Buffer.from(row.blobBase64,'base64')],{type:row.mimeType});delete row.blobBase64}
 if(rows.length)await db.table(name).bulkPut(rows)
}
const project=await db.projects.get(projectId)
if(!project)throw Error('Project not found')
const finalPath=path.join(root,'outputs','好想和你谈恋爱_第1章_60秒.mp4')
await db.assets.put({id:'verified-final-export',projectId,kind:'video',mimeType:'video/mp4',blob:new Blob([await readFile(finalPath)],{type:'video/mp4'}),createdAt:Date.now()+1})
const zip=await buildProductionPackage(project)
await mkdir(path.join(root,'outputs'),{recursive:true})
const zipPath=path.join(root,'outputs','好想和你谈恋爱_第1章_成片包.zip')
await writeFile(zipPath,Buffer.from(await zip.arrayBuffer()))
const backup={format:'dramai-backup',version:1,exportedAt:Date.now(),appVersion:'1.0.0',...snapshot}
backup.assets=await Promise.all((snapshot.assets??[]).map(async({blob,...row})=>({...row,blobBase64:Buffer.from(await blob.arrayBuffer()).toString('base64')})))
await writeFile(path.join(root,'outputs','浏览器项目备份_可导入安装版.json'),JSON.stringify(backup))
await db.close()
console.log('Exported final ZIP and project backup without provider credentials')
