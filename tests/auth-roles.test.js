import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_ADMIN_EMAILS, getAdminEmails, isAdminEmail, isAdminUser, parseAdminEmails } from '../src/auth/roles.js'

test('parseAdminEmails normalizes input', () => {
  assert.deepEqual(parseAdminEmails(' Admin@Example.com , second@example.com '), ['admin@example.com', 'second@example.com'])
  assert.deepEqual(parseAdminEmails(['USER@TEST.dk', '']), ['user@test.dk'])
})

test('getAdminEmails falls back to default when window is missing', () => {
  const originalWindow = globalThis.window
  delete globalThis.window
  assert.deepEqual(getAdminEmails(), DEFAULT_ADMIN_EMAILS.map((email) => email.toLowerCase()))
  // Restore window for other tests
  if (typeof originalWindow !== 'undefined') {
    globalThis.window = originalWindow
  } else {
    delete globalThis.window
  }
})

test('getAdminEmails reads from window whitelist', () => {
  const originalWindow = globalThis.window
  globalThis.window = {
    SHARED_ADMIN_EMAILS: 'Admin@One.dk, second@two.dk',
  }
  assert.deepEqual(getAdminEmails(), ['admin@one.dk', 'second@two.dk'])
  globalThis.window = originalWindow
})

test('isAdminEmail matches normalized values', () => {
  const originalWindow = globalThis.window
  globalThis.window = { SHARED_ADMIN_EMAILS: ['list@demo.dk'] }
  assert.equal(isAdminEmail(' LIST@demo.dk '), true)
  assert.equal(isAdminEmail('other@demo.dk'), false)
  globalThis.window = originalWindow
})

test('isAdminUser prefers permissions and roles over email', () => {
  const originalWindow = globalThis.window
  globalThis.window = { SHARED_ADMIN_EMAILS: ['fallback@demo.dk'] }
  assert.equal(isAdminUser({ email: 'fallback@demo.dk', permissions: ['admin:app'] }), true)
  assert.equal(isAdminUser({ email: 'member@demo.dk', roles: ['sscaff_admin'] }), true)
  assert.equal(isAdminUser({ email: 'fallback@demo.dk', permissions: [] }), true)
  assert.equal(isAdminUser({ email: 'member@demo.dk', permissions: ['read:app'] }), false)
  globalThis.window = originalWindow
})
