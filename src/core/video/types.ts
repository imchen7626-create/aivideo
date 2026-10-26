import type { ApiFlavor } from '@/types/domain'

export interface I2VRequest {
  model: string
  prompt: string
  /** 起始帧。 */
  imageBlob: Blob
  /** 整数秒，常见值 5 / 10。 */
  durationSec?: number
  /** "9:16" / "16:9" / "1:1" 等。 */
  aspectRatio?: string
  /** 让 client 把它翻译成各家协议自己的运镜字段。 */
  cameraInstruction?: string
  /** 480P / 720P / 1080P；不支持的模型按自身能力降级。 */
  resolution?: '480P' | '720P' | '1080P'
  /** 音频驱动（口型同步）：百炼临时存储里的 oss:// 地址。 */
  audioUrl?: string
  /** 尾帧：运镜终点画面（万相 3.0 / 2.7 首尾帧模式），不支持的模型忽略。 */
  lastFrameBlob?: Blob
  signal?: AbortSignal
}

export interface I2VTaskHandle {
  taskId: string
  apiFlavor: ApiFlavor
}

export type I2VStatus =
  | { kind: 'queued' }
  | { kind: 'processing'; progress?: number; message?: string }
  | { kind: 'succeeded'; videoUrl: string; durationSec?: number }
  | { kind: 'failed'; message: string }

export interface I2VClient {
  /** 提交一个图生视频任务，立刻返回 task handle。不在这里下载视频。 */
  submit(req: I2VRequest): Promise<I2VTaskHandle>
  /** 轮询任务状态。succeeded 时返回视频 URL，调用方负责下载。 */
  poll(handle: I2VTaskHandle, signal?: AbortSignal): Promise<I2VStatus>
}
