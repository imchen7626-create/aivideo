/** 把本地文件上传到百炼临时存储（48 小时有效），返回 oss:// 地址，供指定模型读取。 */
export async function uploadToDashScope(
  apiKey: string,
  model: string,
  blob: Blob,
  name: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(
    `/api/bailian/upload?model=${encodeURIComponent(model)}&name=${encodeURIComponent(name)}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob,
      signal,
    },
  )
  if (!res.headers.get('content-type')?.includes('application/json'))
    throw new Error('本地百炼服务版本过旧，请重启生产台。')
  const data = (await res.json()) as { url?: string; message?: string }
  if (!res.ok || !data.url) throw new Error(`上传配音到百炼失败（HTTP ${res.status}）：${data.message ?? ''}`)
  return data.url
}
