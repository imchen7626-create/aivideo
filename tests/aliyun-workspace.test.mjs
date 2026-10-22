import {test} from 'node:test'
import assert from 'node:assert/strict'
import {validWorkspaceOrigin} from '../scripts/aliyun-workspace-proxy.mjs'
import {workspaceModel,workspaceFetch,workspaceMedia} from '../src/core/aliyun-workspace.ts'
test('only official public workspace origins are accepted',()=>{
 assert.equal(validWorkspaceOrigin('https://llm-example.cn-beijing.maas.aliyuncs.com'),true)
 for(const url of ['http://127.0.0.1','https://localhost','https://example.com','https://llm-example.cn-beijing.maas.aliyuncs.com.evil.test','https://user:password@llm-example.cn-beijing.maas.aliyuncs.com','https://llm-example.cn-beijing.maas.aliyuncs.com:8080','https://llm-example.cn-beijing.maas.aliyuncs.com/path'])assert.equal(validWorkspaceOrigin(url),false)
})
test('known display names resolve to official IDs and custom IDs remain intact',()=>{
 assert.equal(workspaceModel('千问-图片生成大模型','image'),'qwen-image-2.1-turbo')
 assert.equal(workspaceModel('wan3','video'),'wan3.0-video')
 assert.equal(workspaceModel('custom-deployment','image'),'custom-deployment')
})
test('credentials go through local relay to the same workspace',async t=>{
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  assert.equal(url,'/api/aliyun/compatible-mode/v1/images/generations')
  assert.equal(options.headers.get('X-Provider-Origin'),'https://llm-example.cn-beijing.maas.aliyuncs.com')
  assert.equal(options.headers.get('Authorization'),'Bearer test-key')
  return Response.json({data:[]})
 })
 await workspaceFetch('https://llm-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/images/generations',{method:'POST',headers:{Authorization:'Bearer test-key'},body:'{}'})
})
test('only generated official media is relayed',()=>{
 assert.match(workspaceMedia('https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/test.png'),/^\/api\/bailian\/media/)
 assert.equal(workspaceMedia('https://example.com/image.png'),'https://example.com/image.png')
})
test('a workspace host saved without a scheme is completed and recognised',async()=>{
 const {normalizeBaseUrl,isWorkspaceUrl}=await import('../src/core/aliyun-workspace.ts')
 assert.equal(normalizeBaseUrl(' demo.cn-beijing.maas.aliyuncs.com '),'https://demo.cn-beijing.maas.aliyuncs.com')
 assert.ok(isWorkspaceUrl(normalizeBaseUrl('demo.cn-beijing.maas.aliyuncs.com')))
 for(const v of ['/api/bailian','https://api.302ai.cn','http://127.0.0.1:8080/v1','123',''])assert.equal(normalizeBaseUrl(v),v)
})
