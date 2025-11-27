import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_KM_RATE, resolveKmBelob, resolveKmInputValue } from '../src/lib/extras-helpers.js'

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

test('resolveKmBelob derives amount from km count when no amount is provided', () => {
  const extras = { km: 37 }
  assert.equal(resolveKmBelob(extras, DEFAULT_KM_RATE), 37 * DEFAULT_KM_RATE)
})

test('resolveKmBelob preserves provided amount when available', () => {
  const extras = { kmBelob: 12.72 }
  assert.equal(resolveKmBelob(extras, DEFAULT_KM_RATE), 12.72)
})
