import assert from 'node:assert/strict'
import test from 'node:test'

import { __test as panelTest } from '../js/shared-cases-panel.js'

test('backoff grows exponentially and caps at max', () => {
  const originalRandom = Math.random
  Math.random = () => 0.5
  try {
    const v1 = panelTest.computePollBackoffMs(1)
    const v2 = panelTest.computePollBackoffMs(2)
    const v3 = panelTest.computePollBackoffMs(3)
    const v10 = panelTest.computePollBackoffMs(10)

    assert.equal(v1, 2000)
    assert.equal(v2, 4000)
    assert.equal(v3, 8000)
    assert.equal(v10, 60000)
  } finally {
    Math.random = originalRandom
  }
})
