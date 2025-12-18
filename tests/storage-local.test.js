import assert from 'node:assert/strict'
import test from 'node:test'

import { clearDraft, loadDraft, saveDraft } from '../js/storageDraft.js'
import { appendHistoryEntry, deleteHistoryEntry, loadHistory, migrateHistory } from '../js/storageHistory.js'

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
    const draft = {
      sagsinfo: {
        sagsnummer: '42',
        navn: 'Testvej 1',
        adresse: '1234 Byen',
        kunde: 'Kunde A'
      },
      materials: [
        { id: 'mat-1', name: 'Rør', quantity: 10, price: 2.5 },
        { id: 'mat-2', name: 'Fodplade', quantity: 5, price: 12 }
      ],
      labor: [{ id: 'worker-1', hours: 3.5, rate: 250 }],
      extras: { jobType: 'montage', kmAntal: 12 }
    }

    saveDraft(draft)

    const loaded = loadDraft()
    assert.deepEqual(loaded, draft)

    const raw = storage.getItem('csmate:draftJob:v1')
    const parsed = JSON.parse(raw)
    assert.equal(parsed.schemaVersion, 1)
    assert.equal(parsed.data.sagsinfo.sagsnummer, '42')
    assert.equal(parsed.data.materials.length, 2)
    assert.equal(parsed.data.labor.length, 1)
    assert.ok(typeof parsed.updatedAt === 'number')
  })
})

test('loadDraft tolerates invalid payloads', () => {
  withMockWindow((storage) => {
    assert.equal(loadDraft(), null)

    storage.setItem('csmate:draftJob:v1', '{invalid-json')
    assert.equal(loadDraft(), null)
    assert.equal(storage.getItem('csmate:draftJob:v1'), null)

    storage.setItem('csmate:draftJob:v1', JSON.stringify({ schemaVersion: 0, data: { foo: 'bar' } }))
    assert.equal(loadDraft(), null)
    assert.equal(storage.getItem('csmate:draftJob:v1'), null)
  })
})

test('loadHistory clears invalid stored state', () => {
  withMockWindow((storage) => {
    storage.setItem('csmate:history:v1', '{bad-json')
    assert.deepEqual(loadHistory(), [])
    assert.equal(storage.getItem('csmate:history:v1'), null)

    storage.setItem('csmate:history:v1', JSON.stringify({ schemaVersion: 0, data: [] }))
    assert.deepEqual(loadHistory(), [])
    assert.equal(storage.getItem('csmate:history:v1'), null)

    storage.setItem('csmate:history:last', '{bad-json')
    appendHistoryEntry({ id: 'h-1', jobId: 'job-1', createdAt: 1 })
    const lastRaw = storage.getItem('csmate:history:last')
    const parsed = JSON.parse(lastRaw)
    assert.ok(parsed.key.startsWith('time:'), 'last attempt should be refreshed with valid data')
  })
})

test('clearDraft removes stored draft', () => {
  withMockWindow((storage) => {
    storage.setItem('csmate:draftJob:v1', JSON.stringify({ schemaVersion: 1, data: { jobId: 'old' } }))

    clearDraft()

    assert.equal(storage.getItem('csmate:draftJob:v1'), null)
    assert.equal(loadDraft(), null)
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
    for (let index = 1; index <= 205; index++) {
      appendHistoryEntry({ id: `id-${index}`, jobId: `job-${index}`, createdAt: index })
    }

    const history = loadHistory()
    assert.equal(history.length, 200)
    assert.equal(history[0].jobId, 'job-205')
    assert.equal(history.at(-1).jobId, 'job-6')
  })
})

test('appendHistoryEntry upserts entries with matching sagsnummer', () => {
  withMockWindow(() => {
    appendHistoryEntry({ meta: { sagsnummer: '123', navn: 'Første' }, createdAt: 1 })
    const updated = appendHistoryEntry({ meta: { sagsnummer: '123', navn: 'Opdateret' }, createdAt: 5 })

    const history = loadHistory()
    assert.equal(history.length, 1)
    assert.equal(history[0].meta.navn, 'Opdateret')
    assert.equal(history[0].createdAt, updated.createdAt)
  })
})

test('appendHistoryEntry dedupes identical payloads via historyKey', () => {
  withMockWindow(() => {
    const payload = { info: { sagsnummer: '900', navn: 'Testvej' }, totals: { projektsum: 500 } }
    appendHistoryEntry({ payload, createdAt: 1 })
    appendHistoryEntry({ payload: { ...payload }, createdAt: 5 })

    const history = loadHistory()
    assert.equal(history.length, 1)
    assert.equal(history[0].createdAt, 5)
  })
})

test('appendHistoryEntry replaces older entries for same case with changed payload', () => {
  withMockWindow(() => {
    const firstPayload = { info: { sagsnummer: '4242', navn: 'Testvej' }, totals: { projektsum: 100 } }
    const secondPayload = { info: { sagsnummer: '4242', navn: 'Testvej' }, totals: { projektsum: 275 } }

    appendHistoryEntry({ meta: { sagsnummer: '4242' }, payload: firstPayload, createdAt: 1 })
    appendHistoryEntry({ meta: { sagsnummer: '4242' }, payload: secondPayload, createdAt: 5 })

    const history = loadHistory()
    assert.equal(history.length, 1)
    assert.equal(history[0].payload.totals.projektsum, 275)
    assert.equal(history[0].createdAt, 5)
  })
})

test('migrateHistory dedupes entries without sagsnummer using fallback key', () => {
  withMockWindow((storage) => {
    const raw = {
      schemaVersion: 1,
      data: [
        { id: 'a', meta: { navn: 'Test', adresse: 'Vej 1' }, createdAt: 1 },
        { id: 'b', meta: { navn: 'Test', adresse: 'Vej 1' }, createdAt: 5 },
      ]
    }
    storage.setItem('csmate:history:v1', JSON.stringify(raw))

    const migrated = migrateHistory()
    assert.equal(migrated.length, 1)
    assert.equal(migrated[0].id, 'a')
    assert.equal(migrated[0].createdAt, 5)
    assert.equal(loadHistory().length, 1)
  })
})
