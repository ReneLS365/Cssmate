import assert from 'node:assert/strict'
import test from 'node:test'

import { __test as panelTest } from '../js/shared-cases-panel.js'

const { handleExportedEvent, setRefreshHandler, setTestState } = panelTest

test('export event triggers shared cases refresh when case id is present', async () => {
  let refreshCalls = 0
  setTestState({
    session: {
      accessStatus: 'ok',
      sessionReady: true,
      user: { uid: 'user-1', email: 'user@example.com' },
    },
    teamIdValue: 'hulmose',
  })

  setRefreshHandler(async () => {
    refreshCalls += 1
  })

  try {
    await handleExportedEvent({ caseId: 'case-1', type: 'shared' })
    assert.equal(refreshCalls, 1)
  } finally {
    setRefreshHandler()
  }
})
