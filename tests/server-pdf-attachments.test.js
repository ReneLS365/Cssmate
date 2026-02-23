import assert from 'node:assert/strict'
import test from 'node:test'

import { handler } from '../netlify/functions/api.mjs'

const ORIGINAL_ENV = {
  CONTEXT: process.env.CONTEXT,
  NETLIFY_CONTEXT: process.env.NETLIFY_CONTEXT,
  URL: process.env.URL,
  DEPLOY_URL: process.env.DEPLOY_URL,
  DEPLOY_PRIME_URL: process.env.DEPLOY_PRIME_URL,
}

function setPreviewContext () {
  process.env.CONTEXT = 'deploy-preview'
  process.env.NETLIFY_CONTEXT = 'deploy-preview'
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

test('preview blocks PDF upload write route', async () => {
  setPreviewContext()
  const res = await handler({
    httpMethod: 'POST',
    path: '/teams/hulmose/cases/abc/pdf',
    headers: { authorization: 'Bearer fake' },
    body: JSON.stringify({ pdfBase64: 'ZmFrZQ==', phase: 'montage' }),
    queryStringParameters: {},
  })
  assert.equal(res.statusCode, 403)
  const payload = JSON.parse(res.body)
  assert.equal(payload.code, 'preview_writes_disabled')
  assert.equal(payload.action, 'case_pdf_upload')
})
