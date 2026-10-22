import type { Provider } from '../types/domain'
import {isWorkspaceUrl, normalizeBaseUrl} from './aliyun-workspace.ts'

const textModels = new Set(['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-flash'])
const mediaNames = { text2image: '文生图', image2video: '图生视频', imageEdit: '图片编辑', tts:'语音合成' }

export function getProviderCapabilityError(provider: Pick<Provider, 'kind' | 'model'> & Partial<Pick<Provider,'baseUrl'|'apiFlavor'>>): string | undefined {
  if(provider.kind==='text2image'&&isWorkspaceUrl(provider.baseUrl??'')&&provider.model.trim()==='fluxqwen-image-3.0')return '图像模型名有误：fluxqwen-image-3.0 不在当前工作区模型列表中。Flux 与 Qwen 是不同模型；请在模型设置中修正为 qwen-image-3.0，或填写服务商提供的完整模型 ID。'
  if(provider.kind==='image2video'){
    // 每镜都从首帧图出发，文生视频模型不接收首帧，提交即浪费费用。
    if(/(?:^|[-_.])t2v(?:[-_.]|$)/i.test(provider.model.trim()))return `模型不匹配：${provider.model} 是文生视频（t2v）模型，不接收首帧图，不能用于图生视频。请在模型设置中换成图生视频（i2v）模型，例如 wan2.6-i2v-flash。`
    if(provider.apiFlavor==='bailian'&&!isWorkspaceUrl(normalizeBaseUrl(provider.baseUrl??''))&&provider.model.trim()!=='wan2.2-i2v-flash')return `百炼官方接入（/api/bailian）目前只支持 wan2.2-i2v-flash，当前模型为 ${provider.model}。使用百炼工作区的其他模型时，请把接口地址填写为完整的 https://…maas.aliyuncs.com 工作区地址。`
  }
  if (provider.kind === 'llm' || !textModels.has(provider.model.trim().toLowerCase())) return
  return `配置不匹配：${provider.model} 是文本模型，不能用于${mediaNames[provider.kind]}。请在模型设置中为${mediaNames[provider.kind]}配置对应的模型、接口地址和该服务商的 API Key。DeepSeek 文本配置可继续用于脚本、角色卡、方案和 Prompt。`
}
