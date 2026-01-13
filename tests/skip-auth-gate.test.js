import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldSkipAuthGate } from '../src/auth/skip-auth-gate.js'

function setWindowLocation(searchValue) {
  globalThis.window = {
    location: {
      search: searchValue,
      pathname: '/',
    },
  }
}

test('shouldSkipAuthGate returns true for skipAuthGate flags only', () => {
  const originalWindow = globalThis.window

  try {
    setWindowLocation('?skipAuthGate=1')
    assert.equal(shouldSkipAuthGate(), true)

    setWindowLocation('?skipAuthGate=true')
    assert.equal(shouldSkipAuthGate(), true)

    setWindowLocation('?ci=1')
    assert.equal(shouldSkipAuthGate(), false)
  } finally {
    globalThis.window = originalWindow
    if (originalWindow === undefined) delete globalThis.window
  }
})
