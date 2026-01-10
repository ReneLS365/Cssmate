import assert from 'node:assert/strict'
import test from 'node:test'

import { buildUserFromToken } from '../js/shared-auth.js'

const TOKEN_STORAGE_KEY = 'cssmate:authToken'

function createStorage () {
  const store = new Map()
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, String(value))
    },
    removeItem: (key) => {
      store.delete(key)
    },
  }
}

function makeJwt (payload) {
  const header = { alg: 'HS256', typ: 'JWT' }
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode(header)}.${encode(payload)}.signature`
}

test('buildUserFromToken clears expired tokens', () => {
  const originalWindow = globalThis.window
  const storage = createStorage()
  const expiredToken = makeJwt({
    sub: 'user-1',
    email: 'test@example.com',
    exp: Math.floor(Date.now() / 1000) - 60,
  })

  globalThis.window = {
    localStorage: storage,
  }
  storage.setItem(TOKEN_STORAGE_KEY, expiredToken)

  try {
    const user = buildUserFromToken(expiredToken)
    assert.equal(user, null)
    assert.equal(storage.getItem(TOKEN_STORAGE_KEY), null)
  } finally {
    globalThis.window = originalWindow
    if (originalWindow === undefined) delete globalThis.window
  }
})
