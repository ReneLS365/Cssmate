import assert from 'node:assert/strict'
import test from 'node:test'

import { __test as panelTest } from '../js/shared-cases-panel.js'

test('maps preview write lock and includes request id passthrough', () => {
  const mapped = panelTest.mapSharedCasesError({
    code: 'preview_writes_disabled',
    requestId: 'req-1',
  })
  assert.equal(mapped.message, 'Du er på preview. Åbn production-linket for at kunne dele.')
  assert.equal(mapped.requestId, 'req-1')
})

test('maps db drift/setup errors', () => {
  const mapped = panelTest.mapSharedCasesError({ code: 'DB_NOT_MIGRATED' })
  assert.equal(mapped.message, 'Server mangler DB setup. Kontakt admin.')
})

test('maps network errors', () => {
  const mapped = panelTest.mapSharedCasesError(new TypeError('Failed to fetch'))
  assert.equal(mapped.message, 'Offline / ingen forbindelse.')
})
