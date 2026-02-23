import assert from 'node:assert/strict'
import test from 'node:test'

import { handler } from '../netlify/functions/api.mjs'

const ORIGINAL_ENV = {
  CONTEXT: process.env.CONTEXT,
  NETLIFY_CONTEXT: process.env.NETLIFY_CONTEXT,
  ALLOW_LOCAL_WRITES: process.env.ALLOW_LOCAL_WRITES,
  URL: process.env.URL,
  DEPLOY_URL: process.env.DEPLOY_URL,
  DEPLOY_PRIME_URL: process.env.DEPLOY_PRIME_URL,
}

function makeEvent (method, path, body = null) {
  return {
    httpMethod: method,
    path,
    headers: { authorization: 'Bearer fake' },
    queryStringParameters: {},
    body: body ? JSON.stringify(body) : null,
  }
}

function setPreviewContext () {
  process.env.CONTEXT = 'deploy-preview'
  process.env.NETLIFY_CONTEXT = 'deploy-preview'
  delete process.env.ALLOW_LOCAL_WRITES
  process.env.URL = 'https://deploy-preview-123--cssmate.netlify.app'
  process.env.DEPLOY_URL = 'https://deploy-preview-123--cssmate.netlify.app'
  process.env.DEPLOY_PRIME_URL = 'https://deploy-preview-123--cssmate.netlify.app'
}

test.after(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

test('preview blocks case create write', async () => {
  setPreviewContext()
  const res = await handler(makeEvent('POST', '/teams/hulmose/cases', { jobNumber: 'X-1' }))
  assert.equal(res.statusCode, 403)
  const payload = JSON.parse(res.body)
  assert.equal(payload.code, 'preview_writes_disabled')
  assert.equal(payload.action, 'case_create')
})

test('preview blocks case status write', async () => {
  setPreviewContext()
  const res = await handler(makeEvent('PATCH', '/teams/hulmose/cases/abc/status', { status: 'godkendt' }))
  assert.equal(res.statusCode, 403)
  const payload = JSON.parse(res.body)
  assert.equal(payload.code, 'preview_writes_disabled')
  assert.equal(payload.action, 'case_status')
})

test('preview blocks case approve write', async () => {
  setPreviewContext()
  const res = await handler(makeEvent('POST', '/teams/hulmose/cases/abc/approve', {}))
  assert.equal(res.statusCode, 403)
  const payload = JSON.parse(res.body)
  assert.equal(payload.code, 'preview_writes_disabled')
  assert.equal(payload.action, 'case_approve')
})

test('preview blocks case delete write', async () => {
  setPreviewContext()
  const res = await handler(makeEvent('DELETE', '/teams/hulmose/cases/abc'))
  assert.equal(res.statusCode, 403)
  const payload = JSON.parse(res.body)
  assert.equal(payload.code, 'preview_writes_disabled')
  assert.equal(payload.action, 'case_delete')
})


test('preview blocks member self upsert write', async () => {
  setPreviewContext()
  const res = await handler(makeEvent('POST', '/teams/hulmose/members/self', {}))
  assert.equal(res.statusCode, 403)
  const payload = JSON.parse(res.body)
  assert.equal(payload.code, 'preview_writes_disabled')
  assert.equal(payload.action, 'member_self_upsert')
})

test('preview blocks backup import write', async () => {
  setPreviewContext()
  const res = await handler(makeEvent('POST', '/teams/hulmose/backup', { cases: [] }))
  assert.equal(res.statusCode, 403)
  const payload = JSON.parse(res.body)
  assert.equal(payload.code, 'preview_writes_disabled')
  assert.equal(payload.action, 'backup_import')
})

test('preview read route is not blocked by write gate', async () => {
  setPreviewContext()
  const res = await handler(makeEvent('GET', '/teams/hulmose/cases'))
  const payload = JSON.parse(res.body)
  assert.notEqual(payload.code, 'preview_writes_disabled')
})
