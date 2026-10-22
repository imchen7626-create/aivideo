import {test} from 'node:test'
import assert from 'node:assert/strict'
import {getProviderCapabilityError} from '../src/core/provider-capabilities.ts'
test('DeepSeek chat remains valid for the text pipeline',()=>assert.equal(getProviderCapabilityError({kind:'llm',model:'deepseek-chat'}),undefined))
test('DeepSeek chat does not qualify as an image or video model',()=>{
  for(const kind of ['text2image','image2video','imageEdit']) assert.match(getProviderCapabilityError({kind,model:'deepseek-chat'}),/配置不匹配/)
})
test('media models on third-party gateways are not blocked by a label or hostname',()=>{
  assert.equal(getProviderCapabilityError({kind:'text2image',model:'doubao-seedream-5-0-260128'}),undefined)
  assert.equal(getProviderCapabilityError({kind:'image2video',model:'wan2.2-i2v-flash'}),undefined)
})
test('a confirmed concatenated workspace model name is caught before any paid generation',()=>{
 assert.match(getProviderCapabilityError({kind:'text2image',model:'fluxqwen-image-3.0',baseUrl:'https://demo.cn-beijing.maas.aliyuncs.com'}),/qwen-image-3.0/)
 assert.equal(getProviderCapabilityError({kind:'text2image',model:'qwen-image-3.0',baseUrl:'https://demo.cn-beijing.maas.aliyuncs.com'}),undefined)
 assert.equal(getProviderCapabilityError({kind:'text2image',model:'fluxqwen-image-3.0',baseUrl:'https://example.com'}),undefined)
})
test('text-to-video models are caught in the image-to-video slot before any paid request',()=>{
 assert.match(getProviderCapabilityError({kind:'image2video',model:'happyhorse-1.1-t2v'}),/t2v/)
 assert.match(getProviderCapabilityError({kind:'image2video',model:'wan2.2-t2v-plus'}),/i2v/)
 assert.equal(getProviderCapabilityError({kind:'image2video',model:'wan2.6-i2v-flash'}),undefined)
})
test('the local Bailian route only takes its supported model; workspace addresses take others',()=>{
 assert.match(getProviderCapabilityError({kind:'image2video',model:'wan3.0-video-prime',apiFlavor:'bailian',baseUrl:'/api/bailian'}),/wan2\.2-i2v-flash/)
 assert.equal(getProviderCapabilityError({kind:'image2video',model:'wan2.2-i2v-flash',apiFlavor:'bailian',baseUrl:'/api/bailian'}),undefined)
 assert.equal(getProviderCapabilityError({kind:'image2video',model:'wan3.0-video-prime',apiFlavor:'bailian',baseUrl:'demo.cn-beijing.maas.aliyuncs.com'}),undefined)
})
