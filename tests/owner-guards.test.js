import assert from 'node:assert/strict'
import test from 'node:test'

import { ensureActiveAdminGuard } from '../netlify/functions/owner-guards.mjs'

test('ensureActiveAdminGuard blocks disabling the last active admin', () => {
  const admins = [{ user_sub: 'admin-1', status: 'active' }]
  const allowed = ensureActiveAdminGuard({
    admins,
    targetUserId: 'admin-1',
    existingRole: 'admin',
    existingStatus: 'active',
    nextRole: 'member',
    nextStatus: 'active',
    isDelete: false,
  })

  assert.equal(allowed, false)
})

test('ensureActiveAdminGuard allows disabling when another active admin exists', () => {
  const admins = [
    { user_sub: 'admin-1', status: 'active' },
    { user_sub: 'admin-2', status: 'active' },
  ]
  const allowed = ensureActiveAdminGuard({
    admins,
    targetUserId: 'admin-1',
    existingRole: 'admin',
    existingStatus: 'active',
    nextRole: 'member',
    nextStatus: 'active',
    isDelete: false,
  })

  assert.equal(allowed, true)
})

test('ensureActiveAdminGuard blocks deleting the last active admin', () => {
  const admins = [
    { user_sub: 'admin-1', status: 'active' },
    { user_sub: 'admin-2', status: 'removed' },
  ]
  const allowed = ensureActiveAdminGuard({
    admins,
    targetUserId: 'admin-1',
    existingRole: 'admin',
    existingStatus: 'active',
    nextRole: 'admin',
    nextStatus: 'active',
    isDelete: true,
  })

  assert.equal(allowed, false)
})

test('ensureActiveAdminGuard allows demoting a disabled admin', () => {
  const admins = [{ user_sub: 'admin-1', status: 'active' }]
  const allowed = ensureActiveAdminGuard({
    admins,
    targetUserId: 'admin-2',
    existingRole: 'admin',
    existingStatus: 'disabled',
    nextRole: 'member',
    nextStatus: 'disabled',
    isDelete: false,
  })

  assert.equal(allowed, true)
})
