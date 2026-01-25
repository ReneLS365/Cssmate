import assert from 'node:assert/strict'
import test from 'node:test'

import { __test as apiTest } from '../netlify/functions/api.mjs'
import { db } from '../netlify/functions/_db.mjs'
import { __test__ as auth0Test } from '../src/auth/auth0-client.js'
import { registerTeamMemberOnce, __test as teamMembersTest } from '../src/services/team-members.js'

test('registerTeamMemberOnce caches per session key', async () => {
  teamMembersTest.resetRegistrationOnceCache()
  auth0Test.setClient({
    getTokenSilently: async () => 'token',
  })

  const originalFetch = global.fetch
  const calls = []
  global.fetch = async (url, options) => {
    calls.push({ url, options })
    return {
      ok: true,
      json: async () => ({ member: { role: 'member' } }),
    }
  }

  try {
    const user = { sub: 'auth0|user-1', email: 'user@example.com' }
    const first = await registerTeamMemberOnce({ teamId: 'hulmose', user, role: 'member' })
    const second = await registerTeamMemberOnce({ teamId: 'hulmose', user, role: 'member' })

    assert.equal(calls.length, 1)
    assert.deepEqual(first, second)
  } finally {
    global.fetch = originalFetch
    auth0Test.resetClient()
    teamMembersTest.resetRegistrationOnceCache()
  }
})

test('registerTeamMemberOnce allows force override', async () => {
  teamMembersTest.resetRegistrationOnceCache()
  auth0Test.setClient({
    getTokenSilently: async () => 'token',
  })

  const originalFetch = global.fetch
  const calls = []
  global.fetch = async (url, options) => {
    calls.push({ url, options })
    return {
      ok: true,
      json: async () => ({ member: { role: 'member' } }),
    }
  }

  try {
    const user = { sub: 'auth0|user-2', email: 'user2@example.com' }
    await registerTeamMemberOnce({ teamId: 'hulmose', user, role: 'member' })
    await registerTeamMemberOnce({ teamId: 'hulmose', user, role: 'member', force: true })

    assert.equal(calls.length, 2)
  } finally {
    global.fetch = originalFetch
    auth0Test.resetClient()
    teamMembersTest.resetRegistrationOnceCache()
  }
})

test('ensureTeam avoids writes on existing team', async () => {
  const originalContext = process.env.CONTEXT
  process.env.CONTEXT = 'production'

  const originalQuery = db.query
  const queries = []
  db.query = async (text, params) => {
    queries.push(text)
    if (text.includes('INSERT INTO teams')) {
      return { rows: [] }
    }
    if (text.includes('SELECT id, slug, name, created_at, created_by_sub')) {
      return { rows: [{ id: 'team-id', slug: params[0], name: params[0], created_at: null, created_by_sub: null }] }
    }
    throw new Error(`Unexpected query: ${text}`)
  }

  try {
    const team = await apiTest.ensureTeam('Hulmose')
    assert.equal(team.slug, 'hulmose')
    assert.match(queries[0], /ON CONFLICT \(slug\) DO NOTHING/)
    assert.equal(queries.length, 2)
  } finally {
    db.query = originalQuery
    process.env.CONTEXT = originalContext
  }
})

test('team members list self-heals missing member in production', async () => {
  const originalQuery = db.query
  const queries = []
  db.query = async (text, params) => {
    queries.push(text)
    if (text.includes('FROM team_members') && text.includes('WHERE team_id = $1 AND user_sub = $2')) {
      return { rows: [] }
    }
    if (text.includes('INSERT INTO team_members')) {
      return {
        rows: [
          {
            team_id: params[0],
            user_sub: params[1],
            email: params[2],
            display_name: 'Test User',
            role: params[4],
            status: 'active',
            joined_at: new Date('2024-01-01T00:00:00Z'),
            last_login_at: new Date('2024-01-01T00:00:00Z'),
            last_seen_at: new Date('2024-01-01T00:00:00Z'),
          },
        ],
      }
    }
    if (text.includes('FROM team_members') && text.includes('WHERE team_id = $1 AND status !=')) {
      return { rows: [] }
    }
    throw new Error(`Unexpected query: ${text}`)
  }

  try {
    const members = await apiTest.listTeamMembersForUser({
      team: { id: 'team-id' },
      user: { id: 'user-1', email: 'user@example.com', name: 'Test User', isPrivileged: false },
      isProduction: true,
    })

    assert.equal(members.length, 1)
    assert.equal(members[0].uid, 'user-1')
    assert.ok(queries.some((query) => query.includes('INSERT INTO team_members')))
  } finally {
    db.query = originalQuery
  }
})
