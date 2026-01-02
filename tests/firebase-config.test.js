import assert from 'node:assert/strict'
import test from 'node:test'

import { clearFirebaseConfigCache, loadFirebaseConfig } from '../src/config/firebase-config.js'
import { sanitizeFirebaseConfig, validateFirebaseConfig } from '../src/config/firebase-utils.js'

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

test('loadFirebaseConfig reads config from env', async () => {
  const originalWindow = globalThis.window
  const originalEnv = { ...process.env }

  process.env.VITE_FIREBASE_API_KEY = 'AIzaSyTestKey1234567890'
  process.env.VITE_FIREBASE_AUTH_DOMAIN = 'demo.firebaseapp.com'
  process.env.VITE_FIREBASE_PROJECT_ID = 'demo'
  process.env.VITE_FIREBASE_APP_ID = 'app-id'

  try {
    clearFirebaseConfigCache()
    const config = await loadFirebaseConfig()
    assert.equal(config.apiKey, 'AIzaSyTestKey1234567890')
    assert.equal(config.authDomain, 'demo.firebaseapp.com')
    assert.equal(config.projectId, 'demo')
    assert.equal(config.appId, 'app-id')
  } finally {
    clearFirebaseConfigCache()
    globalThis.window = originalWindow
    if (originalWindow === undefined) delete globalThis.window
    process.env = originalEnv
  }
})

test('loadFirebaseConfig reads config from session storage', async () => {
  const originalWindow = globalThis.window
  const originalEnv = { ...process.env }
  const sessionStorage = {
    store: new Map(),
    getItem(key) {
      return this.store.get(key) ?? null
    },
    setItem(key, value) {
      this.store.set(key, value)
    },
    removeItem(key) {
      this.store.delete(key)
    },
    clear() {
      this.store.clear()
    },
  }

  globalThis.window = { sessionStorage }
  delete process.env.VITE_FIREBASE_API_KEY
  delete process.env.VITE_FIREBASE_AUTH_DOMAIN
  delete process.env.VITE_FIREBASE_PROJECT_ID
  delete process.env.VITE_FIREBASE_APP_ID

  const storedConfig = {
    apiKey: 'AIzaSySessionKey1234567890',
    authDomain: 'session.firebaseapp.com',
    projectId: 'session-project',
    appId: 'session-app',
  }

  try {
    sessionStorage.setItem('cssmate:firebaseConfig', JSON.stringify(storedConfig))
    clearFirebaseConfigCache()
    const config = await loadFirebaseConfig()
    assert.equal(config.apiKey, storedConfig.apiKey)
    assert.equal(config.authDomain, storedConfig.authDomain)
    assert.equal(config.projectId, storedConfig.projectId)
    assert.equal(config.appId, storedConfig.appId)
  } finally {
    clearFirebaseConfigCache()
    globalThis.window = originalWindow
    if (originalWindow === undefined) delete globalThis.window
    process.env = originalEnv
  }
})

test('loadFirebaseConfig throws when required env vars are missing', async () => {
  const originalEnv = { ...process.env }

  delete process.env.VITE_FIREBASE_API_KEY
  delete process.env.VITE_FIREBASE_AUTH_DOMAIN
  delete process.env.VITE_FIREBASE_PROJECT_ID
  delete process.env.VITE_FIREBASE_APP_ID

  try {
    clearFirebaseConfigCache()
    await assert.rejects(loadFirebaseConfig(), /Missing env vars/)
  } finally {
    clearFirebaseConfigCache()
    process.env = originalEnv
  }
})
