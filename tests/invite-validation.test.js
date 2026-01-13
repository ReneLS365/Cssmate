import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeInviteRecord } from '../src/services/teams.js'

test('normalizeInviteRecord rejects malformed invites', () => {
  assert.equal(normalizeInviteRecord(null), null)
  assert.equal(normalizeInviteRecord({}), null)
  assert.equal(normalizeInviteRecord({ teamId: 'hulmose' }), null)
})

test('normalizeInviteRecord normalizes valid invites', () => {
  const normalized = normalizeInviteRecord({
    id: 'invite-1',
    teamId: 'HulMose',
    email: 'Test@Example.com',
    role: 'admin',
  })

  assert.equal(normalized?.teamId, 'hulmose')
  assert.equal(normalized?.emailLower, 'test@example.com')
  assert.equal(normalized?.role, 'admin')
})
