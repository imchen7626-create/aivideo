import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export function validWorkspaceOrigin(value) {
  try {
    const u = new URL(value)
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && u.pathname === '/' && !u.search && !u.hash && /^[a-z0-9-]+\.(?:cn-beijing|cn-hongkong|ap-southeast-1|us-east-1|eu-central-1|ap-northeast-1)\.maas\.aliyuncs\.com$/.test(u.hostname)
  } catch { return false }
}
export async function handleWorkspace(req,res) {
  const url = new URL(req.url,'http://localhost')
  if (!url.pathname.startsWith('/api/aliyun/')) return false
  res.setHeader('Cache-Control','no-store')
  if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(req.headers.host||'') || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) || req.headers['sec-fetch-site']==='cross-site') { res.writeHead(403).end(); return true }
  const base = req.headers['x-provider-origin']
  const route = url.pathname.slice('/api/aliyun'.length)
  const allowed = (req.method==='POST' && ['/compatible-mode/v1/images/generations','/api/v1/services/aigc/video-generation/video-synthesis','/api/v1/services/aigc/multimodal-generation/generation'].includes(route)) || (req.method==='GET' && (route==='/compatible-mode/v1/models' || /^\/api\/v1\/tasks\/[a-zA-Z0-9_-]+$/.test(route)))
  if (!validWorkspaceOrigin(base)||!allowed||!req.headers.authorization?.startsWith('Bearer ')) { res.writeHead(400).end(); return true }
  const headers = { Authorization:req.headers.authorization }
  let body
  if (req.method==='POST') {
    if (!req.headers['content-type']?.startsWith('application/json')) { res.writeHead(415).end(); return true }
    const chunks=[]; let size=0
    for await (const chunk of req) {size+=chunk.length;if(size>16*1024*1024){res.writeHead(413).end();return true}chunks.push(chunk)}
    body=Buffer.concat(chunks); headers['Content-Type']='application/json'
    if (route.includes('/video-generation/')) headers['X-DashScope-Async']='enable'
    if (req.headers['x-dashscope-ossresourceresolve']==='enable') headers['X-DashScope-OssResourceResolve']='enable'
  }
  try {
    const upstream=await fetch(`${base}${route}`,{method:req.method,body,headers,redirect:'error',signal:AbortSignal.timeout(180000)})
    res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type')||'application/json'})
    if(upstream.body)await pipeline(Readable.fromWeb(upstream.body),res);else res.end()
  } catch {
    if(!res.headersSent)res.writeHead(502,{'Content-Type':'application/json'}).end(JSON.stringify({message:'无法连接当前百炼业务空间。生成请求可能已受理，请先在百炼控制台核实再重试。'}));else res.destroy()
  }
  return true
}
