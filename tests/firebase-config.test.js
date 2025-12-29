import assert from 'node:assert/strict'
import test from 'node:test'

import { sanitizeFirebaseConfig, validateFirebaseConfig } from '../src/config/firebase.js'

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
