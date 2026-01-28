import assert from 'node:assert/strict'
import test from 'node:test'

import { __test } from '../netlify/functions/api.mjs'

const { canAccessCase, resolveCaseTransition } = __test

test('draft visibility is team-scoped for shared cases', () => {
  assert.equal(
    canAccessCase({ status: 'kladde', createdBy: 'user-a', userSub: 'user-a', isPrivileged: false }),
    true
  )
  assert.equal(
    canAccessCase({ status: 'kladde', createdBy: 'user-a', userSub: 'user-b', isPrivileged: false }),
    true
  )
  assert.equal(
    canAccessCase({ status: 'godkendt', createdBy: 'user-a', userSub: 'user-b', isPrivileged: false }),
    true
  )
})

test('montage approve transitions kladde -> godkendt', () => {
  const next = resolveCaseTransition({
    action: 'APPROVE',
    currentStatus: 'kladde',
    sheetPhase: 'montage',
    isCreator: true,
  })
  assert.deepEqual(next, { status: 'godkendt', phase: 'montage' })
})

test('non-creator cannot approve draft', () => {
  assert.throws(
    () => resolveCaseTransition({
      action: 'APPROVE',
      currentStatus: 'kladde',
      sheetPhase: 'montage',
      isCreator: false,
    }),
    /Kun opretter kan godkende kladden/
  )
})

test('demontage export transitions godkendt -> afsluttet', () => {
  const next = resolveCaseTransition({
    action: 'EXPORT_DEMONTAGE',
    currentStatus: 'godkendt',
    sheetPhase: 'demontage',
    isCreator: false,
  })
  assert.deepEqual(next, { status: 'afsluttet', phase: 'demontage' })
})

test('demontage export rejects draft', () => {
  assert.throws(
    () => resolveCaseTransition({
      action: 'EXPORT_DEMONTAGE',
      currentStatus: 'kladde',
      sheetPhase: 'montage',
      isCreator: true,
    }),
    /Montage skal godkendes/
  )
})

test('demontage approve transitions demontage_i_gang -> afsluttet', () => {
  const next = resolveCaseTransition({
    action: 'APPROVE',
    currentStatus: 'demontage_i_gang',
    sheetPhase: 'demontage',
    isCreator: false,
  })
  assert.deepEqual(next, { status: 'afsluttet', phase: 'demontage' })
})
