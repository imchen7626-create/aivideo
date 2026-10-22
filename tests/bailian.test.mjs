import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateBailianImage, createBailianVideoClient } from '../src/core/bailian.ts'
import { isBailianMediaUrl, handleBailian } from '../scripts/bailian-proxy.mjs'

const provider = { baseUrl: '/api/bailian', apiKey: 'test-key', model: 'z-image-turbo' }
const json = (data) => Response.json(data)
test('image request uses native schema, low-cost settings, and downloads the returned image', async (t) => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options })
    return calls.length === 1
      ? json({
          output: {
            choices: [
              {
                message: {
                  content: [
                    { image: 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a.png' },
                  ],
                },
              },
            ],
          },
        })
      : new Response('png', { headers: { 'Content-Type': 'image/png' } })
  })
  const result = await generateBailianImage(provider, {
    model: provider.model,
    prompt: '一只猫',
    size: '720x1280',
  })
  const body = JSON.parse(calls[0].options.body)
  assert.deepEqual(body.input.messages[0].content, [{ text: '一只猫' }])
  assert.deepEqual(body.parameters, { size: '720*1280', prompt_extend: false })
  assert.match(calls[1].url, /^\/api\/bailian\/media\?url=/)
  assert.equal(result.images[0].blob.type, 'image/png')
})
test('unsupported reference images fail before any paid request', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('must not call')
  })
  await assert.rejects(
    generateBailianImage(provider, { prompt: 'cat', referenceImages: [new Blob()] }),
    /不支持参考图/,
  )
  assert.equal(fetchMock.mock.callCount(), 0)
})
test('video uploads actual image bytes and polls task to a downloadable result', async (t) => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options })
    return calls.length === 1
      ? json({ output: { task_id: 'task-1' } })
      : json({
          output: {
            task_status: 'SUCCEEDED',
            video_url: 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a.mp4',
          },
        })
  })
  const client = createBailianVideoClient({ ...provider, model: 'wan2.2-i2v-flash' })
  const handle = await client.submit({
    prompt: 'cat',
    imageBlob: new Blob(['abc'], { type: 'image/png' }),
    durationSec: 5,
  })
  const body = JSON.parse(calls[0].options.body)
  assert.equal(body.input.img_url, 'data:image/png;base64,YWJj')
  assert.equal(body.parameters.resolution, '720P')
  assert.equal(body.parameters.duration, 5)
  const status = await client.poll(handle)
  assert.equal(status.kind, 'succeeded')
  assert.equal(status.durationSec, 5)
  assert.match(calls[1].url, /\/tasks\/task-1$/)
})
test('uncertain submission is never automatically retried', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('network')
  })
  const client = createBailianVideoClient({ ...provider, model: 'wan2.2-i2v-flash' })
  await assert.rejects(
    client.submit({ prompt: 'cat', imageBlob: new Blob(['a'], { type: 'image/png' }) }),
    /可能已受理/,
  )
  assert.equal(mock.mock.callCount(), 1)
})
test('quota failure is explained instead of silently switching provider', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ code: 'AllocationQuota.FreeTierOnly' }, { status: 403 }),
  )
  await assert.rejects(generateBailianImage(provider, { prompt: 'cat' }), /免费额度已用完/)
})
test('media proxy only accepts official result storage hosts', () => {
  assert.equal(
    isBailianMediaUrl('https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a?token=x'),
    true,
  )
  // Qwen-TTS audio links are plain http on OSS; the proxy upgrades them to https.
  assert.equal(isBailianMediaUrl('http://dashscope-result-wlcb.oss-cn-wulanchabu.aliyuncs.com/a.wav?Expires=1'), true)
  for (const url of [
    'http://127.0.0.1/a',
    'https://evil.com/a',
    'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com.evil.com/a',
    'https://u:p@dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a',
  ])
    assert.equal(isBailianMediaUrl(url), false)
})
test('proxy rejects requests from other sites and unrelated API routes', async () => {
  for (const [url, headers, expected] of [
    ['/api/bailian/health', { host: 'localhost:5173', origin: 'https://evil.com' }, 403],
    ['/api/bailian/api/v1/other', { host: 'localhost:5173' }, 404],
  ]) {
    const res = {
      setHeader() {},
      writeHead(code) {
        this.code = code
        return this
      },
      end() {},
    }
    assert.equal(await handleBailian({ url, headers, method: 'GET' }, res), true)
    assert.equal(res.code, expected)
  }
})
