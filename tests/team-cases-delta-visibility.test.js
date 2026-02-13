import assert from 'node:assert/strict'
import test from 'node:test'

import { classifyDeltaRow } from '../netlify/functions/_team-cases.mjs'

test('classifyDeltaRow returns deleted for deleted rows', () => {
  const row = { case_id: 'c1', status: 'godkendt', deleted_at: '2026-01-01T00:00:00.000Z', created_by: 'user-a' }
  assert.equal(classifyDeltaRow({ row, userSub: 'user-a', isPrivileged: false }), 'deleted')
})

test('classifyDeltaRow returns deleted for non-privileged users when row turns into another users draft', () => {
  const row = { case_id: 'c2', status: 'kladde', deleted_at: null, created_by: 'user-a' }
  assert.equal(classifyDeltaRow({ row, userSub: 'user-b', isPrivileged: false }), 'deleted')
})

test('classifyDeltaRow keeps own drafts and privileged access active', () => {
  const ownDraft = { case_id: 'c3', status: 'kladde', deleted_at: null, created_by: 'user-a' }
  const otherDraft = { case_id: 'c4', status: 'kladde', deleted_at: null, created_by: 'user-a' }
  assert.equal(classifyDeltaRow({ row: ownDraft, userSub: 'user-a', isPrivileged: false }), 'active')
  assert.equal(classifyDeltaRow({ row: otherDraft, userSub: 'user-b', isPrivileged: true }), 'active')
})
