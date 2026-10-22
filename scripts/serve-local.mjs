import http from 'node:http'
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleBailian } from './bailian-proxy.mjs'
import { handleWorkspace } from './aliyun-workspace-proxy.mjs'

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export function startStudioServer({ root = defaultRoot, dataDirectory, port = 5173, onLog = () => {} } = {}) {
const dist = path.join(root, 'dist')
const data = dataDirectory || path.join(root, 'local-data')
const origin = `http://127.0.0.1:${port}`
const snapshotPath = path.join(data, 'database.json')
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png' }
let writes = Promise.resolve()
const server = http.createServer(async (req, res) => {
  try {
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) { res.writeHead(403).end(); return }
    const url = new URL(req.url, origin)
    if (await handleBailian(req, res)) return
    if (await handleWorkspace(req, res)) return
    if (url.pathname === '/api/local-db') {
      if ((req.headers.origin && req.headers.origin !== origin && req.headers.origin !== `http://localhost:${port}`) || req.headers['sec-fetch-site'] === 'cross-site') { res.writeHead(403).end(); return }
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Content-Type', 'application/json')
      if (req.method === 'GET') {
        let bytes = '{}'
        try { bytes = await readFile(snapshotPath) } catch(e) { if(e.code !== 'ENOENT') throw e }
        res.end(bytes); return
      }
      if (req.method !== 'PUT' || !req.headers['content-type']?.startsWith('application/json')) { res.writeHead(405).end(); return }
      let size = 0; const chunks = []
      for await (const chunk of req) {
        size += chunk.length
        if (size > 512 * 1024 * 1024) { res.writeHead(413).end('{"error":"Local database exceeds 512 MB"}'); return }
        chunks.push(chunk)
      }
      const body = Buffer.concat(chunks)
      const parsed = JSON.parse(body.toString('utf8'))
      const tables = ['projects','characters','materials','storyboards','assets','generations','productions']
      if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).some(k => !tables.includes(k)) || tables.some(k => !Array.isArray(parsed[k]))) { res.writeHead(400).end('{"error":"Invalid snapshot"}'); return }
      const write = writes.then(async () => { await mkdir(data, { recursive: true }); await writeFile(snapshotPath+'.tmp', body); await rename(snapshotPath+'.tmp',snapshotPath) })
      writes = write.catch(() => {})
      await write; res.end('{"ok":true}'); return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return }
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const target = path.resolve(dist, relative || 'index.html')
    if (!target.startsWith(dist + path.sep)) { res.writeHead(403).end(); return }
    let file = target; let bytes
    try { bytes = await readFile(file) } catch (e) {
      if (!['ENOENT','EISDIR'].includes(e.code)) throw e
      if (path.extname(relative)) { res.writeHead(404).end(); return }
      file = path.join(dist,'index.html'); bytes = await readFile(file)
    }
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.end(req.method === 'HEAD' ? undefined : bytes)
  } catch { res.writeHead(500).end('{"error":"Local storage or file operation failed"}') }
})
server.listen(port, '127.0.0.1', () => onLog(`AI Short Drama Studio: ${origin}`))
server.on('error', err => { onLog(err.message); process.exitCode=1 })
return server
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startStudioServer({onLog:message=>console.log(message)})
