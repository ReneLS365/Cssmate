import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeInviteRecord } from '../src/services/teams.js'

test('normalizeInviteRecord rejects malformed invites', () => {
  assert.equal(normalizeInviteRecord(null, 'user@example.com'), null)
  assert.equal(normalizeInviteRecord({ teamId: '', emailLower: 'user@example.com' }), null)
  assert.equal(normalizeInviteRecord({ teamId: 'hulmose', emailLower: '' }), null)
})

test('normalizeInviteRecord normalizes valid invites', () => {
  const invite = normalizeInviteRecord({
    id: 'custom',
    teamId: 'SSCaff-team-Hulmose',
    email: 'User@Example.com',
    role: 'admin',
  })
  assert.ok(invite)
  assert.equal(invite.id, 'custom')
  assert.equal(invite.teamId, 'hulmose')
  assert.equal(invite.emailLower, 'user@example.com')
  assert.equal(invite.role, 'admin')
  assert.equal(invite.active, true)
})
