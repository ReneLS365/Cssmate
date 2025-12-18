import assert from 'node:assert/strict'
import test from 'node:test'

import { formatTeamId, getDisplayTeamId, normalizeTeamId } from '../js/shared-ledger.js'
import { formatMissingMembershipMessage } from '../js/shared-cases-panel.js'

test('normalizeTeamId trims, lowercases og fjerner ulovlige tegn', () => {
  assert.equal(normalizeTeamId(' Hulmose '), 'hulmose')
  assert.equal(normalizeTeamId('TEAM--One!!'), 'team-one')
  assert.equal(normalizeTeamId('sscaff-team-Alpha'), 'alpha')
})

test('formatTeamId tilføjer præfiks én gang', () => {
  assert.equal(formatTeamId('alpha'), 'sscaff-team-alpha')
  assert.equal(formatTeamId('sscaff-team-bravo'), 'sscaff-team-bravo')
})

test('getDisplayTeamId viser læsbar slug', () => {
  assert.equal(getDisplayTeamId('sscaff-team-hulmose'), 'hulmose')
  assert.equal(getDisplayTeamId('hulmose'), 'hulmose')
})

test('formatMissingMembershipMessage inkluderer sti til memberDoc', () => {
  const message = formatMissingMembershipMessage('sscaff-team-demo', 'uid-123')
  assert.match(message, /teams\/sscaff-team-demo\/members\/uid-123/)
  assert.match(message.toLowerCase(), /ikke medlem/)
})
