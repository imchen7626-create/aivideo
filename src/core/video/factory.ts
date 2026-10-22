import type { Provider } from '@/types/domain'
import type { I2VClient } from '@/core/video/types'
import { createAliyunClient } from '@/core/video/aliyun-client'
import { createKlingClient } from '@/core/video/kling-client'
import { createOpenAICompatibleVideoClient } from '@/core/video/openai-compat-client'
import { createVolcengineClient } from '@/core/video/volcengine-client'
import { getProviderCapabilityError } from '@/core/provider-capabilities'
import { createBailianVideoClient } from '@/core/bailian'
import { isWorkspaceUrl } from '@/core/aliyun-workspace'

/**
 * 根据 Provider.apiFlavor 选客户端。
 *  - 'aliyun'                    → 阿里云通义万相 DashScope
 *  - 'volcengine'                → 火山方舟（即梦 Seedance / Doubao 视频）
 *  - 'kling'                     → Kling 原生协议
 *  - 'openai-compatible' / 缺省  → 通用兼容路径（POST /videos/generations）
 *
 * Runway 协议待 v0.5+ 接入；在那之前 Runway 用户用 OpenAI-compat 透传兜底。
 */
export function createVideoClient(provider: Provider): I2VClient {
  const error = getProviderCapabilityError({ ...provider, kind: 'image2video' })
  if (error) throw new Error(error)
  if (isWorkspaceUrl(provider.baseUrl)) return createAliyunClient(provider)
  const flavor = provider.apiFlavor ?? 'openai-compatible'
  if (flavor === 'bailian') return createBailianVideoClient(provider)
  if (flavor === 'aliyun') return createAliyunClient(provider)
  if (flavor === 'kling') return createKlingClient(provider)
  if (flavor === 'volcengine') return createVolcengineClient(provider)
  // 'runway' 暂时用通用客户端兜底
  return createOpenAICompatibleVideoClient(provider)
}
