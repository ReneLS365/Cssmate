import assert from 'node:assert/strict'
import test from 'node:test'

import { __test } from '../js/shared-cases-panel.js'

const { fetchCasesPage, resetCaseState, setListSharedCasesPage, setTestState } = __test

test('shared cases pagination fetches one page unless load more is requested', async () => {
  let calls = 0
  const stub = async () => {
    calls += 1
    return {
      items: [
        {
          caseId: `case-${calls}`,
          status: 'godkendt',
          createdAt: '2024-01-01T10:00:00.000Z',
          updatedAt: '2024-01-01T10:00:00.000Z',
        },
      ],
      nextCursor: { createdAt: '2024-01-01T10:00:00.000Z', caseId: `case-${calls}` },
    }
  }

  setListSharedCasesPage(stub)
  try {
    setTestState({
      session: {
        accessStatus: 'ok',
        sessionReady: true,
        user: { uid: 'user-1', email: 'user@example.com' },
      },
      teamIdValue: 'hulmose',
    })
    resetCaseState()

    const firstPage = await fetchCasesPage({ reset: true })
    assert.equal(calls, 1)
    assert.equal(firstPage.entries.length, 1)

    const secondPage = await fetchCasesPage({ reset: false })
    assert.equal(calls, 2)
    assert.equal(secondPage.entries.length, 2)
  } finally {
    setListSharedCasesPage()
  }
})
