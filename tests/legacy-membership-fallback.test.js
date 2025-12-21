import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveMembership, resetTeamsFirestoreAdapters, setTeamsFirestoreAdapters } from '../src/services/teams.js'
import { LEDGER_TEAM_PREFIX } from '../src/services/team-ids.js'

test('resolveMembership læser legacy-medlemsdoc og spejler til slug-sti', async (t) => {
  const store = new Map()
  const fakeDb = {}
  const fakeSdk = {
    doc: (db, ...segments) => {
      const path = segments.join('/')
      return { path, id: segments.at(-1) }
    },
    getDocFromServer: async (ref) => fakeSdk.getDoc(ref),
    getDoc: async (ref) => {
      const data = store.get(ref.path)
      return {
        exists: () => Boolean(data),
        data: () => data,
        ref,
      }
    },
    setDoc: async (ref, payload, { merge } = {}) => {
      const existing = store.get(ref.path) || {}
      store.set(ref.path, merge ? { ...existing, ...payload } : payload)
    },
    serverTimestamp: () => new Date(),
  }

  setTeamsFirestoreAdapters({
    getDb: async () => fakeDb,
    getHelpers: async () => fakeSdk,
  })
  t.after(() => resetTeamsFirestoreAdapters())

  const uid = 'user-123'
  const legacyTeamId = `${LEDGER_TEAM_PREFIX}hulmose`
  const legacyPath = `teams/${legacyTeamId}/members/${uid}`
  store.set(legacyPath, { uid, email: 'user@example.com', role: 'member', active: true, teamId: legacyTeamId })

  const result = await resolveMembership(uid, 'hulmose', { emailLower: 'user@example.com' })

  assert.ok(result.membership, 'membership skal findes')
  assert.equal(result.membership.teamId, 'hulmose')
  assert.ok(store.has(`teams/hulmose/members/${uid}`), 'slug-sti skal oprettes, så eksisterende data bevares')
})
