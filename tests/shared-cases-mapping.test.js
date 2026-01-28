import assert from 'node:assert/strict'
import test from 'node:test'

import { __test as ledgerTest } from '../js/shared-ledger.js'
import { __test as panelTest } from '../js/shared-cases-panel.js'

test('mapTeamCaseRow maps case_id to id and workflow phase', () => {
  const row = {
    case_id: '11111111-1111-1111-1111-111111111111',
    team_id: 'team-123',
    status: 'godkendt',
  }
  const mapped = ledgerTest.mapTeamCaseRow(row)
  assert.equal(mapped.id, row.case_id)
  assert.equal(mapped.caseId, row.case_id)
  assert.equal(mapped.teamId, row.team_id)
  assert.equal(mapped.phase, ledgerTest.WORKFLOW_PHASE.READY_FOR_DEMONTAGE)
})

test('resolveEntryBucket places ready_for_demontage in correct bucket', () => {
  const entry = { caseId: 'case-1', phase: 'ready_for_demontage' }
  assert.equal(panelTest.resolveEntryBucket(entry), panelTest.WORKFLOW_PHASE.READY_FOR_DEMONTAGE)
})
