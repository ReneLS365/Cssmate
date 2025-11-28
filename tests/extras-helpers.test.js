import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_KM_RATE, mergeExtrasKm, resolveKmInputValue } from '../src/lib/extras-helpers.js'

test('resolveKmInputValue prefers kmAntal when provided', () => {
  const extras = { kmAntal: 12, km: 25.44 }
  assert.equal(resolveKmInputValue(extras, DEFAULT_KM_RATE), 12)
})

test('resolveKmInputValue derives kmAntal from km amount when flagged as amount', () => {
  const extras = { km: 21.2, kmIsAmount: true }
  assert.equal(resolveKmInputValue(extras, DEFAULT_KM_RATE), 10)
})

test('resolveKmInputValue treats km as count when not flagged as amount', () => {
  const extras = { km: 21.2 }
  assert.equal(resolveKmInputValue(extras, DEFAULT_KM_RATE), 21.2)
})

test('resolveKmInputValue derives kmAntal from kmBelob when provided', () => {
  const extras = { kmBelob: 10.6 }
  assert.equal(resolveKmInputValue(extras, DEFAULT_KM_RATE), 5)
})

test('resolveKmInputValue returns empty string when no km data is available', () => {
  assert.equal(resolveKmInputValue({}, DEFAULT_KM_RATE), '')
})

test('mergeExtrasKm restores km count from extraInputs and keeps amount', () => {
  const extras = { km: 21.2, kmIsAmount: true }
  const extraInputs = { km: 10 }

  const merged = mergeExtrasKm(extras, extraInputs, DEFAULT_KM_RATE)

  assert.equal(merged.kmAntal, 10)
  assert.ok(Math.abs(merged.kmBelob - 21.2) < 1e-9)
  assert.equal(merged.kmIsAmount, true)
})

test('mergeExtrasKm does not override explicit kmBelob', () => {
  const extras = { kmBelob: 15.9, kmIsAmount: true }
  const extraInputs = { km: 5 }

  const merged = mergeExtrasKm(extras, extraInputs, DEFAULT_KM_RATE)

  assert.ok(Math.abs(merged.kmBelob - 15.9) < 1e-9)
  assert.equal(merged.kmAntal, 5)
})
