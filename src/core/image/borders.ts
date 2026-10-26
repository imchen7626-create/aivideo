/**
 * 出图模型偶尔在画面边缘留一条纯白或纯黑的空带（实测底部 80 像素白条），视频会把它一直保留到
 * 镜头推近为止。这里检测四边的纯色带，裁掉后按原尺寸重新铺满（保持画幅比例，居中裁切）。
 */
export interface Bands {
  top: number
  bottom: number
  left: number
  right: number
}

/** 一行（或一列）像素几乎同色且接近纯白或纯黑，就是空带；真实的白墙总有明暗起伏。 */
function blank(data: ArrayLike<number>, width: number, at: (k: number) => number, count: number): boolean {
  let min = 255,
    max = 0,
    sum = 0,
    n = 0
  for (let k = 0; k < count; k += 4) {
    const i = at(k) * 4
    const l = (data[i] * 3 + data[i + 1] * 6 + data[i + 2]) / 10
    if (l < min) min = l
    if (l > max) max = l
    sum += l
    n++
  }
  const mean = sum / n
  return max - min < 12 && (mean > 235 || mean < 20) && width > 0
}

export function blankBands(data: ArrayLike<number>, width: number, height: number): Bands {
  const row = (y: number) => blank(data, width, (x) => y * width + x, width)
  const col = (x: number) => blank(data, width, (y) => y * width + x, height)
  const run = (test: (i: number) => boolean, limit: number) => {
    let n = 0
    while (n < limit && test(n)) n++
    // A one- or two-pixel edge line is harmless; only a visible band is cut.
    return n >= Math.max(4, Math.round(limit * 0.04)) ? n : 0
  }
  return {
    top: run((i) => row(i), Math.floor(height / 4)),
    bottom: run((i) => row(height - 1 - i), Math.floor(height / 4)),
    left: run((i) => col(i), Math.floor(width / 4)),
    right: run((i) => col(width - 1 - i), Math.floor(width / 4)),
  }
}

/** 裁掉空带后、为保持原画幅比例再居中裁切的区域。 */
export function cropWithin(bands: Bands, width: number, height: number) {
  let w = width - bands.left - bands.right,
    h = height - bands.top - bands.bottom
  const aspect = width / height
  if (w / h > aspect) w = Math.round(h * aspect)
  else h = Math.round(w / aspect)
  const x = bands.left + Math.floor((width - bands.left - bands.right - w) / 2)
  const y = bands.top + Math.floor((height - bands.top - bands.bottom - h) / 2)
  return { x, y, w, h }
}

export async function withoutBlankBorders(blob: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') return blob
  try {
    const bitmap = await createImageBitmap(blob)
    const { width, height } = bitmap
    const probe = new OffscreenCanvas(width, height).getContext('2d')!
    probe.drawImage(bitmap, 0, 0)
    const bands = blankBands(probe.getImageData(0, 0, width, height).data, width, height)
    if (!bands.top && !bands.bottom && !bands.left && !bands.right) return blob
    const r = cropWithin(bands, width, height)
    const out = new OffscreenCanvas(width, height)
    out.getContext('2d')!.drawImage(bitmap, r.x, r.y, r.w, r.h, 0, 0, width, height)
    return await out.convertToBlob({ type: 'image/png' })
  } catch {
    return blob
  }
}
