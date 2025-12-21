import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMemberDocPath } from '../src/services/teams.js'

test('buildMemberDocPath uses formatted team id and uid', () => {
  const path = buildMemberDocPath('hulmose', 'abc123')
  assert.equal(path, 'teams/hulmose/members/abc123')
})

test('buildMemberDocPath throws without uid', () => {
  assert.throws(() => buildMemberDocPath('hulmose', ''), /UID/)
})
