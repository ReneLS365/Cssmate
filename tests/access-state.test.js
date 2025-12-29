import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveMembershipStatus, resolveSessionStatus, SESSION_STATUS } from '../src/auth/access-state.js'
import { TEAM_ACCESS_STATUS } from '../src/services/team-access.js'

test('resolveMembershipStatus maps access statuses', () => {
  assert.equal(resolveMembershipStatus(TEAM_ACCESS_STATUS.OK), 'member')
  assert.equal(resolveMembershipStatus(TEAM_ACCESS_STATUS.NO_TEAM), 'no_team')
  assert.equal(resolveMembershipStatus(TEAM_ACCESS_STATUS.NO_AUTH), 'no_auth')
  assert.equal(resolveMembershipStatus(TEAM_ACCESS_STATUS.NO_ACCESS), 'not_member')
  assert.equal(resolveMembershipStatus(TEAM_ACCESS_STATUS.ERROR), 'error')
})

test('resolveSessionStatus maps to admin/member/signed-out', () => {
  assert.equal(
    resolveSessionStatus(TEAM_ACCESS_STATUS.OK, true, 'member'),
    SESSION_STATUS.ADMIN
  )
  assert.equal(
    resolveSessionStatus(TEAM_ACCESS_STATUS.OK, false, 'member'),
    SESSION_STATUS.MEMBER
  )
  assert.equal(
    resolveSessionStatus(TEAM_ACCESS_STATUS.NO_AUTH, false, 'no_auth'),
    SESSION_STATUS.SIGNED_OUT
  )
  assert.equal(
    resolveSessionStatus(TEAM_ACCESS_STATUS.ERROR, false, 'error'),
    SESSION_STATUS.ERROR
  )
  assert.equal(
    resolveSessionStatus(TEAM_ACCESS_STATUS.NO_ACCESS, false, 'not_member'),
    SESSION_STATUS.NO_ACCESS
  )
})
