import assert from 'node:assert/strict'
import test from 'node:test'

import { resetApp } from '../src/utils/reset-app.js'

test('resetApp clears service workers, caches, storage, and indexedDB', async () => {
  const originalWindow = globalThis.window
  const originalNavigator = globalThis.navigator
  const originalCaches = globalThis.caches
  const originalIndexedDb = globalThis.indexedDB

  let localCleared = false
  let sessionCleared = false
  let replacedUrl = ''
  const unregisterCalls = []
  const cacheDeletes = []
  const dbDeletes = []

  const fakeCaches = {
    keys: async () => ['cache-a', 'cache-b'],
    delete: async (key) => {
      cacheDeletes.push(key)
      return true
    },
  }

  const fakeIndexedDb = {
    databases: async () => [{ name: 'csmate_projects' }],
    deleteDatabase: (name) => {
      dbDeletes.push(name)
      const request = {}
      setTimeout(() => {
        if (typeof request.onsuccess === 'function') request.onsuccess()
      }, 0)
      return request
    },
  }

  globalThis.window = {
    location: {
      origin: 'https://example.com',
      pathname: '/app',
      replace: (url) => {
        replacedUrl = url
      },
    },
    localStorage: {
      clear: () => {
        localCleared = true
      },
    },
    sessionStorage: {
      clear: () => {
        sessionCleared = true
      },
    },
    caches: fakeCaches,
    indexedDB: fakeIndexedDb,
  }

  globalThis.navigator = {
    serviceWorker: {
      getRegistrations: async () => [
        { unregister: async () => unregisterCalls.push('a') },
        { unregister: async () => unregisterCalls.push('b') },
      ],
    },
  }

  globalThis.caches = fakeCaches
  globalThis.indexedDB = fakeIndexedDb

  try {
    await resetApp()
    assert.equal(unregisterCalls.length, 2)
    assert.deepEqual(cacheDeletes, ['cache-a', 'cache-b'])
    assert.equal(localCleared, true)
    assert.equal(sessionCleared, true)
    assert.deepEqual(dbDeletes, ['csmate_projects'])
    assert.equal(replacedUrl, 'https://example.com/app?resetDone=1')
  } finally {
    globalThis.window = originalWindow
    globalThis.navigator = originalNavigator
    globalThis.caches = originalCaches
    globalThis.indexedDB = originalIndexedDb
    if (originalWindow === undefined) delete globalThis.window
    if (originalNavigator === undefined) delete globalThis.navigator
    if (originalCaches === undefined) delete globalThis.caches
    if (originalIndexedDb === undefined) delete globalThis.indexedDB
  }
})
