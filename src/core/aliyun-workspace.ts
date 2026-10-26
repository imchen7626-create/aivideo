/** 补全只填了域名的地址（如 xxx.cn-beijing.maas.aliyuncs.com）；相对路径与已有协议的地址保持不变。 */
export function normalizeBaseUrl(value: string): string {
  const v = value.trim()
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:\/|$)/i.test(v) ? `https://${v}` : v
}
export function isWorkspaceUrl(value: string): boolean {
  try { return /^[a-z0-9-]+\.(?:cn-beijing|cn-hongkong|ap-southeast-1|us-east-1|eu-central-1|ap-northeast-1)\.maas\.aliyuncs\.com$/.test(new URL(value).hostname) } catch { return false }
}
export function workspaceModel(model: string, kind: 'image'|'video'): string {
  if(kind==='image' && ['千问-图片生成大模型','千问图片编辑'].includes(model.trim())) return 'qwen-image-2.1-turbo'
  if(kind==='video' && model.trim()==='wan3') return 'wan3.0-video'
  return model
}
export async function workspaceFetch(url: string, options: RequestInit = {}): Promise<Response> {
  if(!isWorkspaceUrl(url))return fetch(url,options)
  const target=new URL(url)
  const headers=new Headers(options.headers);headers.set('X-Provider-Origin',target.origin)
  return fetch(`/api/aliyun${target.pathname}`,{...options,headers,signal:options.signal??AbortSignal.timeout(190000)})
}
/** 429 是限流拒收（未受理、不计费）：退避后重发同一请求，最多 5 次（约 1 分钟）。 */
export async function retryRateLimited(send: () => Promise<Response>, signal?: AbortSignal | null): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await send()
    if (res.status !== 429 || attempt >= 5) return res
    await res.body?.cancel().catch(() => {})
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, 2000 * 2 ** attempt)
      signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason) }, { once: true })
    })
  }
}
export function workspaceMedia(url: string): string {
  try { if(/^[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(new URL(url).hostname))return `/api/bailian/media?url=${encodeURIComponent(url)}` } catch { }
  return url
}
