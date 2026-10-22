import {spawn} from 'node:child_process'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
for(const args of [
 ['node_modules/typescript/bin/tsc','-b'],
 ['node_modules/vite/bin/vite.js','build'],
 ['node_modules/electron-builder/cli.js','--win','nsis','--x64','--config','electron-builder.yml'],
]) {
 const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:root,stdio:'inherit'});child.once('error',reject);child.once('exit',resolve)})
 if(code!==0)process.exit(Number(code)||1)
}
