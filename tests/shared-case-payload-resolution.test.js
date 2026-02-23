import assert from 'node:assert/strict'
import test from 'node:test'

import { __test as ledgerTest } from '../js/shared-ledger.js'
import { __test as apiTest } from '../netlify/functions/api.mjs'

test('resolveCasePayloadForImport vælger montage payload som JSON string', () => {
  const entry = {
    status: 'godkendt',
    phase: 'montage',
    attachments: {
      montage: {
        exported_at: '2026-01-01T12:00:00.000Z',
        payload: { type: 'montage', jobId: 'A-1' },
      },
    },
  }

  const resolved = ledgerTest.resolveCasePayloadForImport(entry)
  assert.equal(resolved, JSON.stringify({ type: 'montage', jobId: 'A-1' }))
})

test('resolveCasePayloadForImport foretrækker demontage ved demontage-status', () => {
  const entry = {
    status: 'demontage_i_gang',
    phase: 'demontage',
    attachments: {
      montage: { payload: { type: 'montage', id: 1 } },
      demontage: { payload: { type: 'demontage', id: 2 } },
    },
  }

  const resolved = ledgerTest.resolveCasePayloadForImport(entry)
  assert.equal(resolved, JSON.stringify({ type: 'demontage', id: 2 }))
})

test('resolveCasePayloadForImport bruger legacy attachments.json.data fallback', () => {
  const entry = {
    status: 'godkendt',
    phase: 'montage',
    attachments: {
      json: { data: '{"type":"legacy"}' },
    },
  }

  const resolved = ledgerTest.resolveCasePayloadForImport(entry)
  assert.equal(resolved, '{"type":"legacy"}')
})

test('serializeCaseRow materialiserer json attachment fra json_content når attachments mangler', () => {
  const serialized = apiTest.serializeCaseRow({
    case_id: '11111111-1111-1111-1111-111111111111',
    team_id: 'team-1',
    status: 'kladde',
    phase: 'montage',
    case_kind: 'montage',
    json_content: '{"type":"legacy-row"}',
    attachments: null,
    created_at: '2026-01-01T10:00:00.000Z',
    updated_at: '2026-01-01T10:00:00.000Z',
    last_updated_at: '2026-01-01T10:00:00.000Z',
  })

  assert.equal(serialized.attachments.json.data, '{"type":"legacy-row"}')
  assert.equal(
    ledgerTest.resolveCasePayloadForImport(serialized),
    '{"type":"legacy-row"}'
  )
})
