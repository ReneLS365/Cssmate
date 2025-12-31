import assert from 'node:assert/strict'
import test from 'node:test'

import { clearFirebaseConfigCache, loadFirebaseConfig } from '../src/config/firebase-config.js'
import { sanitizeFirebaseConfig, validateFirebaseConfig } from '../src/config/firebase-utils.js'

function createStorage() {
  const store = new Map()
  return {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      store.set(key, String(value))
    },
    removeItem: key => {
      store.delete(key)
    },
  }
}

test('validateFirebaseConfig flags missing required keys', () => {
  const result = validateFirebaseConfig({ projectId: 'demo' })
  assert.equal(result.isValid, false)
  assert.ok(result.missingKeys.includes('VITE_FIREBASE_API_KEY'))
  assert.ok(result.missingKeys.includes('VITE_FIREBASE_AUTH_DOMAIN'))
  assert.ok(result.missingKeys.includes('VITE_FIREBASE_APP_ID'))
})

test('validateFirebaseConfig flags placeholder values', () => {
  const result = validateFirebaseConfig({
    apiKey: '***',
    authDomain: 'changeme',
    projectId: 'example-project',
    appId: 'your-app-id',
  })
  assert.equal(result.isValid, false)
  assert.ok(result.placeholderKeys.length >= 2)
})

test('validateFirebaseConfig flags short apiKey values', () => {
  const result = validateFirebaseConfig({
    apiKey: 'short-key',
    authDomain: 'auth.example.com',
    projectId: 'project',
    appId: 'app',
  })
  assert.equal(result.isValid, false)
  assert.ok(result.placeholderKeys.includes('VITE_FIREBASE_API_KEY'))
})

test('sanitizeFirebaseConfig trims and drops empty values', () => {
  const config = sanitizeFirebaseConfig({
    apiKey: ' key ',
    authDomain: ' ',
    projectId: 'proj',
    appId: 'app',
    storageBucket: '',
  })
  assert.equal(config.apiKey, 'key')
  assert.equal(config.projectId, 'proj')
  assert.equal(config.appId, 'app')
  assert.equal(config.authDomain, undefined)
})

test('loadFirebaseConfig uses no-store fetch with cache buster', async () => {
  const originalWindow = globalThis.window
  const originalFetch = globalThis.fetch
  const originalSessionStorage = globalThis.sessionStorage
  const originalLocalStorage = globalThis.localStorage

  const sessionStorage = createStorage()
  const localStorage = createStorage()
  const calls = []

  globalThis.window = {
    location: { origin: 'https://example.com', pathname: '/index.html', search: '' },
    sessionStorage,
    localStorage,
  }
  globalThis.sessionStorage = sessionStorage
  globalThis.localStorage = localStorage
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return {
      ok: true,
      json: async () => ({
        apiKey: 'AIzaSyTestKey1234567890',
        authDomain: 'demo.firebaseapp.com',
        projectId: 'demo',
        appId: 'app-id',
      }),
    }
  }

  try {
    clearFirebaseConfigCache()
    await loadFirebaseConfig()
    assert.equal(calls.length, 1)
    const { url, options } = calls[0]
    assert.equal(options.cache, 'no-store')
    const parsed = new URL(url)
    assert.equal(parsed.pathname, '/.netlify/functions/firebase-config')
    assert.ok(parsed.searchParams.has('t'))
  } finally {
    clearFirebaseConfigCache()
    globalThis.window = originalWindow
    if (originalWindow === undefined) delete globalThis.window
    globalThis.fetch = originalFetch
    globalThis.sessionStorage = originalSessionStorage
    globalThis.localStorage = originalLocalStorage
  }
})
