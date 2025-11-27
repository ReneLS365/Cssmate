import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { handleImportAkkord } from '../js/import-akkord.js'

test('handleImportAkkord resolves after successful import', async t => {
  const originalDocument = globalThis.document
  const originalWindow = globalThis.window

  let changeHandler
  const input = {
    value: 'previous',
    addEventListener(type, handler) {
      if (type === 'change') changeHandler = handler
    },
    removeEventListener(type) {
      if (type === 'change') changeHandler = undefined
    },
    click: mock.fn(),
  }

  const importHandler = mock.fn(() => Promise.resolve())

  globalThis.window = {
    cssmateHandleAkkordImport: importHandler,
  }

  globalThis.document = {
    getElementById: () => input,
  }

  t.after(() => {
    globalThis.document = originalDocument
    globalThis.window = originalWindow
    mock.restoreAll()
  })

  const importPromise = handleImportAkkord()

  assert.ok(changeHandler, 'change handler is registered')
  await changeHandler({ target: { files: ['file.json'] } })

  await importPromise
  assert.equal(importHandler.mock.calls.length, 1, 'cssmate import handler called')
  assert.equal(input.value, '', 'input value is cleared before click')
  assert.equal(input.click.mock.calls.length, 1, 'file dialog is triggered')
})

test('handleImportAkkord propagates failures from cssmateHandleAkkordImport', async t => {
  const originalDocument = globalThis.document
  const originalWindow = globalThis.window

  let changeHandler
  const input = {
    value: 'previous',
    addEventListener(type, handler) {
      if (type === 'change') changeHandler = handler
    },
    removeEventListener(type) {
      if (type === 'change') changeHandler = undefined
    },
    click: mock.fn(),
  }

  const importHandler = mock.fn(() => Promise.reject(new Error('kaput')))

  globalThis.window = {
    cssmateHandleAkkordImport: importHandler,
  }

  globalThis.document = {
    getElementById: () => input,
  }

  t.after(() => {
    globalThis.document = originalDocument
    globalThis.window = originalWindow
    mock.restoreAll()
  })

  const importPromise = handleImportAkkord()

  assert.ok(changeHandler, 'change handler is registered')
  await assert.rejects(async () => {
    await changeHandler({ target: { files: ['file.json'] } })
    await importPromise
  }, /kaput/)

  assert.equal(importHandler.mock.calls.length, 1, 'cssmate import handler called')
})
