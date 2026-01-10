import assert from 'node:assert/strict'
import test from 'node:test'

import { ensureActiveOwnerGuard } from '../netlify/functions/owner-guards.mjs'

test('ensureActiveOwnerGuard blocks disabling the last active owner', () => {
  const owners = [{ user_id: 'owner-1', status: 'active' }]
  const allowed = ensureActiveOwnerGuard({
    owners,
    targetUserId: 'owner-1',
    existingRole: 'owner',
    existingStatus: 'active',
    nextRole: 'owner',
    nextStatus: 'disabled',
    isDelete: false,
  })

  assert.equal(allowed, false)
})

test('ensureActiveOwnerGuard allows disabling when another active owner exists', () => {
  const owners = [
    { user_id: 'owner-1', status: 'active' },
    { user_id: 'owner-2', status: 'active' },
  ]
  const allowed = ensureActiveOwnerGuard({
    owners,
    targetUserId: 'owner-1',
    existingRole: 'owner',
    existingStatus: 'active',
    nextRole: 'owner',
    nextStatus: 'disabled',
    isDelete: false,
  })

  assert.equal(allowed, true)
})

test('ensureActiveOwnerGuard blocks deleting the last active owner if others are disabled', () => {
  const owners = [
    { user_id: 'owner-1', status: 'active' },
    { user_id: 'owner-2', status: 'disabled' },
  ]
  const allowed = ensureActiveOwnerGuard({
    owners,
    targetUserId: 'owner-1',
    existingRole: 'owner',
    existingStatus: 'active',
    nextRole: 'owner',
    nextStatus: 'active',
    isDelete: true,
  })

  assert.equal(allowed, false)
})

test('ensureActiveOwnerGuard allows demoting a disabled owner', () => {
  const owners = [{ user_id: 'owner-1', status: 'active' }]
  const allowed = ensureActiveOwnerGuard({
    owners,
    targetUserId: 'owner-2',
    existingRole: 'owner',
    existingStatus: 'disabled',
    nextRole: 'member',
    nextStatus: 'disabled',
    isDelete: false,
  })

  assert.equal(allowed, true)
})
