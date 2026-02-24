import assert from 'node:assert/strict'
import test from 'node:test'

import { handler } from '../netlify/functions/api.mjs'

test('api unknown route returns error, code and requestId', async () => {
  const event = {
    httpMethod: 'GET',
    path: '/does-not-exist',
    headers: { 'x-nf-request-id': 'nf-req-123' },
    queryStringParameters: {},
    body: null,
  }
  const res = await handler(event)
  assert.equal(res.statusCode, 404)
  const payload = JSON.parse(res.body)
  assert.equal(typeof payload.error, 'string')
  assert.equal(payload.code, 'not_found')
  assert.equal(payload.requestId, 'nf-req-123')
})
