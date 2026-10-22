/**
 * FFmpeg.wasm 单线程版加载器（dynamic import）。
 *
 * **不要**直接在顶层 import @ffmpeg/ffmpeg —— 它和 core wasm 加起来 ~30MB，
 * 用户不点合成永远不该下载。loadFFmpeg() 只在第一次合成时触发拉取，并缓存
 * 单例。
 *
 * 关于多线程：浏览器多线程版需要服务器返回 COOP/COEP headers，GitHub Pages
 * 没法设。所以 dramai 强制用单线程版，速度较慢但能跑——6 个 5 秒视频拼接
 * 大约 30 秒 ~ 2 分钟（取决于分辨率和编码复杂度）。
 */

import type { FFmpeg } from '@ffmpeg/ffmpeg'

let cached: Promise<FFmpeg> | null = null

export async function loadFFmpeg(_onLog?: (line: string) => void): Promise<FFmpeg> {
  if (cached) return cached
  cached = (async () => {
    const [{ FFmpeg }, { toBlobURL }, coreAsset, wasmAsset] = await Promise.all([
      import('@ffmpeg/ffmpeg'),
      import('@ffmpeg/util'),
      import('@ffmpeg/core?url'),
      import('@ffmpeg/core/wasm?url'),
    ])
    const ffmpeg = new FFmpeg()
    await ffmpeg.load({
      coreURL: await toBlobURL(coreAsset.default, 'text/javascript'),
      wasmURL: await toBlobURL(wasmAsset.default, 'application/wasm'),
    })
    return ffmpeg
  })()
  try {
    return await cached
  } catch (err) {
    cached = null // 加载失败时允许下次重试
    throw err
  }
}

export function resetFFmpeg() {
  const previous = cached
  cached = null
  if (previous) void previous.then(ffmpeg=>ffmpeg.terminate()).catch(()=>{})
}

export async function readFFmpegFile(ffmpeg: FFmpeg, path: string): Promise<Blob> {
  const data = await ffmpeg.readFile(path)
  if (typeof data === 'string') {
    return new Blob([data], { type: 'text/plain' })
  }
  // ffmpeg.wasm 单线程模式下 buffer 永远是 ArrayBuffer（非 SharedArrayBuffer），
  // 但 TS 类型签名宽到 ArrayBufferLike，所以 cast 一下。
  return new Blob([data as Uint8Array<ArrayBuffer>], {
    type: 'application/octet-stream',
  })
}

/** 取视频最后一帧（PNG），用作连续镜头下一镜的首帧，实现无缝衔接。 */
export async function extractLastFrame(video: Blob): Promise<Blob> {
  const ffmpeg = await loadFFmpeg()
  const { fetchFile } = await import('@ffmpeg/util')
  const id = Math.random().toString(36).slice(2, 10)
  const input = `lf_${id}.mp4`,
    output = `lf_${id}.png`
  await ffmpeg.writeFile(input, await fetchFile(video))
  try {
    let code = await ffmpeg.exec(['-y', '-sseof', '-0.15', '-i', input, '-frames:v', '1', '-update', '1', output])
    if (code !== 0) code = await ffmpeg.exec(['-y', '-i', input, '-vf', 'reverse', '-frames:v', '1', output])
    if (code !== 0) throw new Error('无法提取上一镜尾帧')
    const data = await ffmpeg.readFile(output)
    if (typeof data === 'string' || !data.length) throw new Error('上一镜尾帧为空')
    return new Blob([data.slice() as Uint8Array<ArrayBuffer>], { type: 'image/png' })
  } finally {
    for (const f of [input, output])
      try {
        await ffmpeg.deleteFile(f)
      } catch {
        /* not created */
      }
  }
}
