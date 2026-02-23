import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

import { __test as panelTest } from '../js/shared-cases-panel.js'

const {
  setTestState,
  setBackupHandlersForTest,
  setRefreshHandler,
  getCapabilities,
  updateAdminControls,
  handleExportBackup,
  handleImportBackup,
} = panelTest

function createElement({ checked = false, files = [] } = {}) {
  return {
    checked,
    files,
    hidden: false,
    disabled: false,
    dataset: {},
    textContent: '',
    value: '',
    style: {},
    setAttribute() {},
    appendChild() {},
    addEventListener() {},
    remove() {},
  }
}

test('export backup uses includeDeleted and triggers download filename pattern', async (t) => {
  const calls = []
  const samplePayload = {
    schemaVersion: 2,
    teamId: 'hulmose',
    exportedAt: '2026-01-10T12:00:00.000Z',
    cases: [],
    audit: [],
  }

  setTestState({
    session: { role: 'admin', sessionReady: true, user: { uid: 'u1' } },
    teamIdValue: 'hulmose',
  })

  const originalDocument = globalThis.document
  const originalWindow = globalThis.window

  const adminToolsEl = createElement()
  const includeDeletedEl = createElement({ checked: true })
  const exportBtn = createElement()
  const importBtn = createElement()
  const fileInput = createElement()
  const statusEl = createElement()
  const focusEl = {
    value: '',
    querySelector: () => ({ hidden: false }),
  }

  const created = []
  globalThis.document = {
    getElementById(id) {
      const map = {
        sharedAdminTools: adminToolsEl,
        sharedBackupIncludeDeleted: includeDeletedEl,
        sharedBackupExportBtn: exportBtn,
        sharedBackupImportBtn: importBtn,
        sharedBackupImportFile: fileInput,
        sharedBackupStatus: statusEl,
        sharedCasesStatusFocus: focusEl,
      }
      return map[id] || null
    },
    createElement: () => {
      const el = createElement()
      created.push(el)
      return el
    },
  }

  globalThis.window = {
    confirm: () => true,
    setTimeout: (fn) => {
      fn()
      return 1
    },
  }

  const downloadSpy = mock.method(URL, 'createObjectURL', () => 'blob:mock')
  const revokeSpy = mock.method(URL, 'revokeObjectURL', () => {})

  const appendCalls = []
  const removeCalls = []
  globalThis.document.body = {
    appendChild: (el) => appendCalls.push(el),
    contains: () => false,
  }
  globalThis.document.documentElement = { appendChild: () => {} }
  globalThis.document.createElement = () => ({
    style: {},
    setAttribute() {},
    appendChild() {},
    addEventListener() {},
    click() {
      calls.push({ download: this.download || '' })
    },
    remove() {
      removeCalls.push(true)
    },
    href: '',
    download: '',
  })

  setBackupHandlersForTest({
    exportFn: async (_teamId, opts) => {
      calls.push({ includeDeleted: opts.includeDeleted })
      return samplePayload
    },
  })

  t.after(() => {
    setBackupHandlersForTest({})
    setRefreshHandler()
    mock.restoreAll()
    globalThis.document = originalDocument
    globalThis.window = originalWindow
  })

  await handleExportBackup()

  assert.equal(calls[0].includeDeleted, true)
  assert.match(calls[1].download, /^cssmate-backup-hulmose-\d{4}-\d{2}-\d{2}\.json$/)
  assert.ok(appendCalls.length >= 1)
  assert.ok(removeCalls.length >= 1)
  assert.equal(downloadSpy.mock.calls.length, 1)
  assert.equal(revokeSpy.mock.calls.length, 1)
  assert.match(statusEl.textContent, /Backup downloadet\./)
})

test('import backup parses json and calls import with validated payload', async (t) => {
  const importCalls = []
  const refreshCalls = []
  const samplePayload = {
    schemaVersion: 2,
    teamId: 'hulmose',
    exportedAt: '2026-01-10T12:00:00.000Z',
    cases: [{ caseId: 'c1' }],
    audit: [{ id: 'a1' }],
  }

  setTestState({
    session: { role: 'admin', sessionReady: true, user: { uid: 'u1' } },
    teamIdValue: 'hulmose',
  })

  const originalDocument = globalThis.document
  const originalWindow = globalThis.window

  const fileInput = createElement({
    files: [{ size: 500, text: async () => JSON.stringify(samplePayload) }],
  })
  const statusEl = createElement()
  const adminToolsEl = createElement()
  const exportBtn = createElement()
  const importBtn = createElement()
  const focusEl = {
    value: '',
    querySelector: () => ({ hidden: false }),
  }

  globalThis.document = {
    getElementById(id) {
      const map = {
        sharedAdminTools: adminToolsEl,
        sharedBackupImportFile: fileInput,
        sharedBackupExportBtn: exportBtn,
        sharedBackupImportBtn: importBtn,
        sharedBackupStatus: statusEl,
        sharedCasesStatusFocus: focusEl,
      }
      return map[id] || null
    },
    createElement: () => createElement(),
    body: { appendChild() {}, contains: () => false },
    documentElement: { appendChild() {} },
  }

  globalThis.window = {
    confirm: () => true,
  }

  setBackupHandlersForTest({
    importFn: async (_teamId, payload) => {
      importCalls.push(payload)
      return true
    },
  })

  setRefreshHandler(async () => {
    refreshCalls.push(true)
  })

  t.after(() => {
    setBackupHandlersForTest({})
    setRefreshHandler()
    globalThis.document = originalDocument
    globalThis.window = originalWindow
  })

  await handleImportBackup()

  assert.equal(importCalls.length, 1)
  assert.equal(importCalls[0].schemaVersion, 2)
  assert.equal(refreshCalls.length, 1)
  assert.match(statusEl.textContent, /Backup importeret\./)
})

test('non-admin hides admin tools', () => {
  setTestState({
    session: { role: 'member', sessionReady: true, user: { uid: 'u1' } },
    teamIdValue: 'hulmose',
  })
  assert.equal(getCapabilities().canBackup, false)

  const originalDocument = globalThis.document
  const adminToolsEl = createElement()
  const focusEl = {
    value: '',
    querySelector: () => ({ hidden: false }),
  }

  globalThis.document = {
    getElementById(id) {
      if (id === 'sharedAdminTools') return adminToolsEl
      if (id === 'sharedCasesStatusFocus') return focusEl
      return null
    },
  }

  try {
    updateAdminControls()
    assert.equal(adminToolsEl.hidden, true)
  } finally {
    globalThis.document = originalDocument
  }
})
