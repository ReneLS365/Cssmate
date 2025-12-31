import assert from 'node:assert/strict'
import test from 'node:test'

import { isDiagnosticsEnabled } from '../src/ui/auth-diagnostics.js'

test('isDiagnosticsEnabled returns true when ?diag=1 is present', () => {
  const originalWindow = globalThis.window

  globalThis.window = {
    location: {
      search: '?diag=1',
      pathname: '/',
    },
  }

  try {
    assert.equal(isDiagnosticsEnabled(), true)
  } finally {
    globalThis.window = originalWindow
    if (originalWindow === undefined) delete globalThis.window
  }
})
