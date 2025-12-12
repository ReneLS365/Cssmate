import assert from 'node:assert/strict'
import test from 'node:test'

import { clearDraft, loadDraft, saveDraft } from '../js/storageDraft.js'
import { appendHistoryEntry, deleteHistoryEntry, loadHistory } from '../js/storageHistory.js'

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
    clear () {
      store.clear()
    }
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

test('saveDraft and loadDraft roundtrip data with metadata', () => {
  withMockWindow((storage) => {
    const draft = { jobId: 'demo', jobName: 'Demo job', type: 'montage' }

    saveDraft(draft)

    const loaded = loadDraft()
    assert.deepEqual(loaded, draft)

    const raw = storage.getItem('csmate:draftJob:v1')
    const parsed = JSON.parse(raw)
    assert.equal(parsed.schemaVersion, 1)
    assert.equal(parsed.data.jobId, 'demo')
    assert.ok(typeof parsed.updatedAt === 'number')
  })
})

test('loadDraft tolerates invalid payloads', () => {
  withMockWindow((storage) => {
    assert.equal(loadDraft(), null)

    storage.setItem('csmate:draftJob:v1', '{invalid-json')
    assert.equal(loadDraft(), null)

    storage.setItem('csmate:draftJob:v1', JSON.stringify({ schemaVersion: 0, data: { foo: 'bar' } }))
    assert.equal(loadDraft(), null)
  })
})

test('clearDraft removes stored draft', () => {
  withMockWindow((storage) => {
    storage.setItem('csmate:draftJob:v1', JSON.stringify({ schemaVersion: 1, data: { jobId: 'old' } }))

    clearDraft()

    assert.equal(storage.getItem('csmate:draftJob:v1'), null)
  })
})

test('appendHistoryEntry normalizes entries and sorts newest first', () => {
  withMockWindow(() => {
    const first = appendHistoryEntry({ jobId: 'old', createdAt: 10 })
    const second = appendHistoryEntry({ jobId: 'new', createdAt: 20, source: 'manual' })

    assert.ok(first.id)
    assert.ok(second.id)

    const history = loadHistory()
    assert.equal(history.length, 2)
    assert.equal(history[0].jobId, 'new')
    assert.equal(history[0].source, 'manual')
    assert.equal(history[1].jobId, 'old')
    assert.equal(history[1].source, 'export')
  })
})

test('deleteHistoryEntry removes the matching entry', () => {
  withMockWindow(() => {
    const keep = appendHistoryEntry({ id: 'keep', jobId: 'keep', createdAt: 1 })
    const drop = appendHistoryEntry({ id: 'drop', jobId: 'drop', createdAt: 2 })

    const next = deleteHistoryEntry(drop.id)

    assert.equal(next.length, 1)
    assert.equal(next[0].id, keep.id)
    assert.equal(loadHistory().length, 1)
  })
})

test('history is trimmed to the maximum number of entries', () => {
  withMockWindow(() => {
    for (let index = 1; index <= 55; index++) {
      appendHistoryEntry({ id: `id-${index}`, jobId: `job-${index}`, createdAt: index })
    }

    const history = loadHistory()
    assert.equal(history.length, 50)
    assert.equal(history[0].jobId, 'job-55')
    assert.equal(history.at(-1).jobId, 'job-6')
  })
})
