import assert from 'node:assert/strict'
import test from 'node:test'

import { calculateTotals } from '../src/modules/calculatetotals.js'

test('calculateTotals sums extra work when provided', () => {
  const totals = calculateTotals({
    materialLines: [],
    extra: {
      tralleløft: 125,
      huller: 20,
      boring: 40,
      lukAfHul: 10,
      opskydeligt: 5,
      km: 15,
      oevrige: 0,
    },
    totalHours: 2,
  })

  assert.equal(totals.ekstraarbejde, 215)
  assert.equal(totals.timeprisUdenTillaeg, totals.samletAkkordsum / 2)
})
