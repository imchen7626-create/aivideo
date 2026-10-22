import {readFile,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import JSZip from 'jszip'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const movie=await readFile(path.join(root,'outputs','好想和你谈恋爱_第1章_60秒.mp4'))
const media={duration:0,width:0,height:0,audio:false}
function scan(start,end){
 for(let offset=start;offset+8<=end;){
  let size=movie.readUInt32BE(offset),head=8;const type=movie.toString('ascii',offset+4,offset+8)
  if(size===1){size=Number(movie.readBigUInt64BE(offset+8));head=16}if(size===0)size=end-offset
  if(size<head||offset+size>end)break
  const data=offset+head
  if(type==='mvhd'){const v=movie[data],scale=movie.readUInt32BE(data+(v?20:12));media.duration=(v?Number(movie.readBigUInt64BE(data+24)):movie.readUInt32BE(data+16))/scale}
  if(type==='tkhd'){const width=movie.readUInt32BE(offset+size-8)/65536,height=movie.readUInt32BE(offset+size-4)/65536;if(width&&height){media.width=width;media.height=height}}
  if(type==='hdlr'&&movie.toString('ascii',data+8,data+12)==='soun')media.audio=true
  if(['moov','trak','mdia'].includes(type))scan(data,offset+size)
  offset+=size
 }
}
scan(0,movie.length)
if(media.width!==720||media.height!==1280||Math.abs(media.duration-60)>0.15||!media.audio)throw Error('MP4 delivery validation failed: '+JSON.stringify(media))
const zip=await JSZip.loadAsync(await readFile(path.join(root,'outputs','好想和你谈恋爱_第1章_成片包.zip')))
const manifest=JSON.parse(await zip.file('production-manifest.json').async('string'))
if(manifest.completedVideos!==12||!manifest.finalIncluded||!zip.file('final.mp4'))throw Error('Incomplete final package')
const installer=await readFile(path.join(root,'release','AI-Short-Drama-Studio-Setup-1.0.0.exe'))
const report={media,package:{videos:manifest.completedVideos,finalIncluded:manifest.finalIncluded,files:Object.keys(zip.files).length},installer:{bytes:installer.length,sha256:createHash('sha256').update(installer).digest('hex')}}
await writeFile(path.join(root,'outputs','交付验证.json'),JSON.stringify(report,null,2))
console.log(JSON.stringify(report))
