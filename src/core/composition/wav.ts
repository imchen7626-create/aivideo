/**
 * PCM WAV 的时长读取与静音补齐。百炼 Qwen-TTS 返回 PCM WAV；口型同步模型对驱动音频有最短时长
 * （wan2.5/2.6 为 3 秒，wan2.7 为 2 秒），短台词需要在末尾补静音后再上传。
 */

interface PcmWav {
  bytesPerSecond: number
  blockAlign: number
  dataOffset: number
  dataSize: number
}

function readPcmWav(bytes: Uint8Array): PcmWav | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))
  if (bytes.length < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return
  let fmt: { bytesPerSecond: number; blockAlign: number } | undefined
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = tag(at)
    const size = view.getUint32(at + 4, true)
    if (id === 'fmt ') {
      if (view.getUint16(at + 8, true) !== 1) return // only uncompressed PCM can be padded with zeros
      fmt = { bytesPerSecond: view.getUint32(at + 16, true), blockAlign: view.getUint16(at + 20, true) }
    } else if (id === 'data') {
      if (!fmt || !fmt.bytesPerSecond || !fmt.blockAlign) return
      // Streamed WAVs may carry a placeholder size: trust the bytes actually present.
      const dataSize = Math.min(size, bytes.length - (at + 8))
      return { ...fmt, dataOffset: at + 8, dataSize: dataSize - (dataSize % fmt.blockAlign) }
    }
    at += 8 + size + (size % 2)
  }
}

export function wavDurationSec(bytes: Uint8Array): number | undefined {
  const wav = readPcmWav(bytes)
  return wav ? wav.dataSize / wav.bytesPerSecond : undefined
}

/** 在末尾补静音直到至少 minSec 秒；不是 PCM WAV 或已经够长时原样返回。 */
export function padWavToMinDuration(bytes: Uint8Array<ArrayBuffer>, minSec: number): Uint8Array<ArrayBuffer> {
  const wav = readPcmWav(bytes)
  if (!wav || wav.dataSize / wav.bytesPerSecond >= minSec) return bytes
  const target = Math.ceil((minSec * wav.bytesPerSecond) / wav.blockAlign) * wav.blockAlign
  const out = new Uint8Array(wav.dataOffset + target)
  out.set(bytes.subarray(0, wav.dataOffset + wav.dataSize))
  const view = new DataView(out.buffer)
  view.setUint32(4, out.length - 8, true)
  view.setUint32(wav.dataOffset - 4, target, true)
  return out
}

/** 口型同步模型要求的驱动音频最短时长（秒），留一点余量。 */
export function lipSyncMinAudioSec(model: string): number {
  return (/^wan2\.7-/.test(model) ? 2 : 3) + 0.1
}
