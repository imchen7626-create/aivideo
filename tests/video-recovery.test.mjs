import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import 'fake-indexeddb/auto'

// Resolve the app's TypeScript aliases without bundling or changing production code.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const url = specifier.startsWith('@/')
      ? new URL('../src/' + specifier.slice(2), import.meta.url)
      : specifier.startsWith('.')
        ? new URL(specifier, context.parentURL)
        : null
    if (url?.protocol === 'file:' && existsSync(fileURLToPath(url) + '.ts'))
      return nextResolve(url.href + '.ts', context)
    return nextResolve(specifier, context)
  },
})
const { db } = await import('../src/core/storage/db.ts')
const { generateShotVideo } = await import('../src/core/pipeline/video-shot.ts')
after(() => db.close())
const provider = {
  id: 'bailian-video',
  baseUrl: '/api/bailian',
  apiKey: 'test-key',
  model: 'wan2.2-i2v-flash',
  apiFlavor: 'bailian',
  kind: 'image2video',
}

test('failed polling retains task, and next run downloads it without a second submission', async (t) => {
  const shot = {
    id: 'recovery-shot',
    projectId: 'test',
    sequence: 1,
    sceneText: 'cat',
    durationSec: 5,
    imageAssetId: 'image',
    status: 'image-ready',
  }
  await db.storyboards.put(shot)
  await db.assets.put({
    id: 'image',
    projectId: 'test',
    kind: 'image',
    blob: new Blob(['image'], { type: 'image/png' }),
  })
  let submits = 0
  let online = false
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options?.method === 'POST') {
      submits++
      return Response.json({ output: { task_id: 'saved-task' } })
    }
    if (url.includes('/tasks/')) {
      if (!online) throw new TypeError('offline')
      return Response.json({
        output: {
          task_status: 'SUCCEEDED',
          video_url: 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a.mp4',
        },
      })
    }
    return new Response('video', { headers: { 'Content-Type': 'video/mp4' } })
  })
  const events = []
  for await (const event of generateShotVideo({ provider, storyboard: shot, pollIntervalMs: 0 }))
    events.push(event)
  assert.equal(events.at(-1).phase, 'error')
  assert.equal((await db.storyboards.get(shot.id)).pendingVideoTask.taskId, 'saved-task')
  online = true
  const resumed = []
  for await (const event of generateShotVideo({ provider, storyboard: shot, pollIntervalMs: 0 }))
    resumed.push(event)
  assert.equal(resumed.at(-1).phase, 'done')
  assert.equal(submits, 1)
  const saved = await db.storyboards.get(shot.id)
  assert.equal(saved.pendingVideoTask, undefined)
  assert.equal(saved.status, 'video-ready')
  assert.equal(await (await db.assets.get(saved.videoAssetId)).blob.text(), 'video')
})

test('switching providers never resubmits an existing task', async (t) => {
  const shot = {
    id: 'other-provider-shot',
    projectId: 'test',
    sceneText: 'cat',
    imageAssetId: 'image',
    pendingVideoTask: {
      taskId: 'old',
      apiFlavor: 'bailian',
      providerId: 'other',
      submittedAt: Date.now(),
    },
  }
  await db.storyboards.put(shot)
  const mock = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('must not call')
  })
  const events = []
  for await (const event of generateShotVideo({ provider, storyboard: shot, pollIntervalMs: 0 }))
    events.push(event)
  assert.match(events.at(-1).message, /切回/)
  assert.equal(mock.mock.callCount(), 0)
})

test('a task that failed while polling is cleared even when the consumer stops at the error', async (t) => {
  await db.storyboards.put({
    id: 'dead-task-shot',
    projectId: 'test',
    sequence: 1,
    sceneText: 'cat',
    durationSec: 5,
    imageAssetId: 'image',
    status: 'image-ready',
    pendingVideoTask: { taskId: 'dead-task', apiFlavor: 'bailian', submittedAt: 1, providerId: provider.id, baseUrl: provider.baseUrl, model: provider.model },
  })
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ output: { task_status: 'FAILED', message: 'Field required: input.media' } }),
  )
  // Same pattern as the runner: throw on the first error event, which ends the generator there.
  await assert.rejects(async () => {
    for await (const e of generateShotVideo({ provider, storyboard: await db.storyboards.get('dead-task-shot'), pollIntervalMs: 1 }))
      if (e.phase === 'error') throw new Error(e.message)
  }, /input\.media/)
  const saved = await db.storyboards.get('dead-task-shot')
  assert.equal(saved.pendingVideoTask, undefined, 'the next retry must not poll the dead task again')
  assert.equal(saved.status, 'failed')
})
