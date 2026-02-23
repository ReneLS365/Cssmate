import assert from 'node:assert/strict'
import test from 'node:test'

import { __test as ledgerTest } from '../js/shared-ledger.js'
import { __test as panelTest } from '../js/shared-cases-panel.js'

test('arrayBufferToBase64 encoder returns expected payload', () => {
  const bytes = new Uint8Array([65, 66, 67]).buffer
  assert.equal(ledgerTest.arrayBufferToBase64(bytes), 'QUJD')
})

test('resolvePdfMeta reads per-phase metadata', () => {
  const entry = {
    attachments: {
      pdf: {
        montage: { key: 'cases/hulmose/id/pdf/montage.pdf', size: 10 },
      },
    },
  }
  assert.equal(panelTest.resolvePdfMeta(entry, 'montage')?.key, 'cases/hulmose/id/pdf/montage.pdf')
  assert.equal(panelTest.resolvePdfMeta(entry, 'demontage'), null)
})

test('shared PDF attachments feature flag follows runtime env', () => {
  const originalWindow = globalThis.window
  globalThis.window = { __ENV__: { VITE_SHARED_PDF_ATTACHMENTS: '1' } }
  assert.equal(panelTest.isSharedPdfAttachmentEnabled(), true)
  globalThis.window = { __ENV__: { VITE_SHARED_PDF_ATTACHMENTS: '0' } }
  assert.equal(panelTest.isSharedPdfAttachmentEnabled(), false)
  globalThis.window = originalWindow
})
