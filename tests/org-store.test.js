import assert from 'node:assert/strict'
import test from 'node:test'

import { clearSavedOrgId, getSavedOrgId, saveOrgId } from '../src/auth/org-store.js'

function createMockStorage () {
  const store = new Map()
  return {
    getItem (key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem (key, value) {
      store.set(key, String(value))
    },
    removeItem (key) {
      store.delete(key)
    },
  }
}

function withMockWindow (fn) {
  const storage = createMockStorage()
  globalThis.window = { localStorage: storage }
  try {
    return fn(storage)
  } finally {
    delete globalThis.window
  }
}

test('org-store saves, loads, and clears org id', () => {
  withMockWindow((storage) => {
    assert.equal(getSavedOrgId(), '')

    saveOrgId('org_123')
    assert.equal(getSavedOrgId(), 'org_123')

    clearSavedOrgId()
    assert.equal(getSavedOrgId(), '')
    assert.equal(storage.getItem('sscaff:org_id'), null)
  })
})
