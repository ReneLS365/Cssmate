import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldSkipAuthGate } from '../src/auth/skip-auth-gate.js'

function setWindowLocation(searchValue) {
  globalThis.window = {
    location: {
      search: searchValue,
      pathname: '/',
    },
    __ENV__: {
      VITE_E2E_BYPASS_AUTH: '1',
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

test('shouldSkipAuthGate ignores query flags in production context', () => {
  const originalWindow = globalThis.window

  try {
    globalThis.window = {
      location: {
        search: '?skipAuthGate=1',
        pathname: '/',
      },
      __ENV__: {
        CONTEXT: 'production',
        VITE_E2E_BYPASS_AUTH: '1',
      },
    }

    assert.equal(shouldSkipAuthGate(), false)
  } finally {
    globalThis.window = originalWindow
    if (originalWindow === undefined) delete globalThis.window
  }
})
