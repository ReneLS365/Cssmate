import assert from 'node:assert/strict'
import test from 'node:test'

import { selectDeterministicInvite } from '../src/services/teams.js'

test('selectDeterministicInvite er case-insensitiv og vælger deterministisk invite for default team', () => {
  const email = 'User@Example.com '
  const deterministicId = 'hulmose__user@example.com'
  const invites = [
    { id: 'custom-beta', teamId: 'beta', emailLower: 'user@example.com', role: 'admin', active: true },
    { id: deterministicId, teamId: 'hulmose', emailLower: 'user@example.com', role: 'member', active: true },
    { id: 'upper-hulmose', teamId: 'SSCaff-team-Hulmose', emailLower: 'USER@EXAMPLE.COM', role: 'admin', active: true },
    { id: 'inactive', teamId: 'sscaff-team-hulmose', emailLower: 'user@example.com', role: 'member', active: false },
    { id: 'other-mail', teamId: 'sscaff-team-hulmose', emailLower: 'other@example.com', role: 'member', active: true },
  ]

  const selection = selectDeterministicInvite(invites, email)
  assert.ok(selection, 'invite bør findes')
  assert.equal(selection.primary.inviteId, deterministicId)
  assert.equal(selection.primary.teamId, 'hulmose')
  assert.equal(selection.primary.emailLower, 'user@example.com')
  assert.equal(selection.primary.role, 'member')
  assert.ok(selection.inviteIds.includes(deterministicId), 'deterministisk id skal være med i inviteIds')
  assert.ok(selection.inviteIds.includes('upper-hulmose'), 'anden invite skal også markeres som brugt')
})
