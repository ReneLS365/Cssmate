import assert from 'node:assert/strict'
import test from 'node:test'

import { __test as panelTest } from '../js/shared-cases-panel.js'

const { computeBucketCounts, WORKFLOW_STATUS } = panelTest

test('shared cases counts stay consistent across buckets', () => {
  const entries = Object.freeze([
    Object.freeze({ caseId: 'case-1', status: WORKFLOW_STATUS.DRAFT, jobNumber: 'JOB-1' }),
    Object.freeze({ caseId: 'case-2', phase: 'ready_for_demontage', jobNumber: 'JOB-2' }),
    Object.freeze({ caseId: 'case-3', status: WORKFLOW_STATUS.DONE, jobNumber: 'JOB-3' }),
    Object.freeze({ caseId: 'case-4', status: WORKFLOW_STATUS.DONE, jobNumber: 'JOB-4' }),
  ])

  const counts = computeBucketCounts(entries)
  assert.equal(counts.get(WORKFLOW_STATUS.DRAFT), 1)
  assert.equal(counts.get(WORKFLOW_STATUS.APPROVED), 1)
  assert.equal(counts.get(WORKFLOW_STATUS.DONE), 2)
})
