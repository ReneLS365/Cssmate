import assert from 'node:assert/strict'
import test from 'node:test'

import { buildAkkordData } from '../js/akkord-data.js'

const KM_RATE = 2.12

test('buildAkkordData preserves km counts and computes amounts', () => {
  const raw = {
    extras: { kmAntal: 5 },
    extraInputs: { km: 5 },
    materials: [],
    totals: {},
  }

  const result = buildAkkordData(raw)
  assert.equal(result.akkord.km, 5)
  assert.equal(result.akkord.kmBelob, 5 * KM_RATE)
  assert.equal(result.extras.kmAntal, 5)
  assert.equal(result.extras.kmBelob, 5 * KM_RATE)
  assert.equal(result.extras.km, 5 * KM_RATE)
})

test('buildAkkordData derives km count from kmBelob when count is missing', () => {
  const raw = {
    extras: { kmBelob: 21.2 },
    materials: [],
    totals: {},
  }

  const result = buildAkkordData(raw)
  assert.equal(result.akkord.km, 10)
  assert.equal(result.akkord.kmBelob, 21.2)
})
