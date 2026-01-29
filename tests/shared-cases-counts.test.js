import assert from 'node:assert/strict'
import test from 'node:test'

import { __test as panelTest } from '../js/shared-cases-panel.js'

const { computeBucketCounts, WORKFLOW_PHASE } = panelTest

test('shared cases counts stay consistent across buckets', () => {
  const entries = Object.freeze([
    Object.freeze({ caseId: 'case-1', phase: WORKFLOW_PHASE.DRAFT, jobNumber: 'JOB-1' }),
    Object.freeze({ caseId: 'case-2', phase: WORKFLOW_PHASE.READY_FOR_DEMONTAGE, jobNumber: 'JOB-2' }),
    Object.freeze({ caseId: 'case-3', phase: WORKFLOW_PHASE.COMPLETED, jobNumber: 'JOB-3' }),
    Object.freeze({ caseId: 'case-4', phase: WORKFLOW_PHASE.COMPLETED, jobNumber: 'JOB-3' }),
  ])

  const counts = computeBucketCounts(entries)
  assert.equal(counts.get(WORKFLOW_PHASE.DRAFT), 1)
  assert.equal(counts.get(WORKFLOW_PHASE.READY_FOR_DEMONTAGE), 1)
  assert.equal(counts.get(WORKFLOW_PHASE.COMPLETED), 1)
})
