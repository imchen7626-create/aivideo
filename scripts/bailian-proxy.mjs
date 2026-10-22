import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export function isBailianMediaUrl(value) {
  try {
    const u = new URL(value)
    return (
      (u.protocol === 'https:' || u.protocol === 'http:') &&
      !u.username &&
      !u.password &&
      !u.port &&
      // DashScope result buckets (images, video, Qwen-TTS audio) on Alibaba Cloud OSS.
      /^[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(u.hostname)
    )
  } catch {
    return false
  }
}

// Shared by the local production server and Vite. Never forwards credentials to media hosts.
export async function handleBailian(req, res) {
  const url = new URL(req.url, 'http://localhost')
  if (!url.pathname.startsWith('/api/bailian/')) return false
  const localHost = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')
  const originOk = !req.headers.origin || req.headers.origin === `http://${req.headers.host}`
  res.setHeader('Cache-Control', 'no-store')
  if (!localHost || !originOk || req.headers['sec-fetch-site'] === 'cross-site') {
    res.writeHead(403).end()
    return true
  }
  if (url.pathname === '/api/bailian/health' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ service: 'bailian-local-proxy', ready: true }))
    return true
  }
  // Upload a local file (e.g. dialogue audio) to DashScope temporary storage and return its oss:// URL.
  // Two steps server-side because the OSS form upload is not reachable from the page (CORS).
  if (url.pathname === '/api/bailian/upload' && req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json')
    const model = url.searchParams.get('model') || ''
    const name = (url.searchParams.get('name') || 'file.bin').replace(/[^\w.-]/g, '_').slice(0, 80)
    if (!req.headers.authorization?.startsWith('Bearer ') || !/^[\w.-]{2,64}$/.test(model)) {
      res.writeHead(400).end(JSON.stringify({ message: '缺少 Key 或模型名' }))
      return true
    }
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > 20 * 1024 * 1024) {
        res.writeHead(413).end(JSON.stringify({ message: '文件超过 20MB' }))
        return true
      }
      chunks.push(chunk)
    }
    try {
      const policyRes = await fetch(
        `https://dashscope.aliyuncs.com/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(model)}`,
        { headers: { Authorization: req.headers.authorization }, signal: AbortSignal.timeout(30000) },
      )
      const policy = await policyRes.json()
      const d = policy?.data
      if (!policyRes.ok || !d?.upload_host) {
        res.writeHead(policyRes.ok ? 502 : policyRes.status).end(
          JSON.stringify({ message: policy?.message || '获取上传凭证失败' }),
        )
        return true
      }
      const key = `${d.upload_dir}/${Date.now()}-${name}`
      const form = new FormData()
      form.append('OSSAccessKeyId', d.oss_access_key_id)
      form.append('Signature', d.signature)
      form.append('policy', d.policy)
      form.append('key', key)
      form.append('x-oss-object-acl', d.x_oss_object_acl)
      form.append('x-oss-forbid-overwrite', d.x_oss_forbid_overwrite)
      form.append('success_action_status', '200')
      form.append('file', new Blob([Buffer.concat(chunks)], { type: req.headers['content-type'] || 'application/octet-stream' }), name)
      const up = await fetch(d.upload_host, { method: 'POST', body: form, signal: AbortSignal.timeout(60000) })
      if (!up.ok) {
        res.writeHead(502).end(JSON.stringify({ message: `上传到百炼临时存储失败（${up.status}）` }))
        return true
      }
      res.end(JSON.stringify({ url: `oss://${key}` }))
    } catch {
      if (!res.headersSent) res.writeHead(502).end(JSON.stringify({ message: '连接百炼上传服务失败' }))
    }
    return true
  }
  let target
  const headers = {}
  let body
  const route = url.pathname.slice('/api/bailian'.length)
  if (route === '/media' && req.method === 'GET') {
    target = url.searchParams.get('url')
    if (!isBailianMediaUrl(target)) {
      res.writeHead(400).end('Unsupported media host')
      return true
    }
    // Qwen-TTS returns http:// links; OSS serves the same signed object over https.
    target = target.replace(/^http:/, 'https:')
  } else {
    const allowed =
      (req.method === 'POST' &&
        [
          '/api/v1/services/aigc/multimodal-generation/generation',
          '/api/v1/services/aigc/video-generation/video-synthesis',
        ].includes(route)) ||
      (req.method === 'GET' && /^\/api\/v1\/tasks\/[a-zA-Z0-9_-]+$/.test(route))
    if (!allowed) {
      res.writeHead(404).end()
      return true
    }
    if (!req.headers.authorization?.startsWith('Bearer ')) {
      res.writeHead(401).end()
      return true
    }
    target = `https://dashscope.aliyuncs.com${route}`
    headers.Authorization = req.headers.authorization
    if (req.method === 'POST') {
      if (!req.headers['content-type']?.startsWith('application/json')) {
        res.writeHead(415).end()
        return true
      }
      headers['Content-Type'] = 'application/json'
      if (route.includes('/video-generation/')) headers['X-DashScope-Async'] = 'enable'
      if (req.headers['x-dashscope-ossresourceresolve'] === 'enable')
        headers['X-DashScope-OssResourceResolve'] = 'enable'
      const chunks = []
      let size = 0
      for await (const chunk of req) {
        size += chunk.length
        if (size > 16 * 1024 * 1024) {
          res.writeHead(413).end()
          return true
        }
        chunks.push(chunk)
      }
      body = Buffer.concat(chunks)
    }
  }
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(180000),
    })
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
    })
    if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), res)
    else res.end()
  } catch {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          message: '连接百炼失败。若为生成请求，可能已受理，请先在百炼控制台核实，避免重复提交。',
        }),
      )
    } else res.destroy()
  }
  return true
}
