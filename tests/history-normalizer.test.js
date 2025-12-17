import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeHistoryEntry, normalizeHistoryList, formatDateLabel, normalizeSearchValue } from '../js/history-normalizer.js'

test('normalizeHistoryEntry respects timestamp for createdAt', () => {
  const entry = { id: 'case-a', timestamp: 1734094140000 }
  const normalized = normalizeHistoryEntry(entry)
  assert.equal(normalized.createdAt, 1734094140000)
  assert.equal(normalized.id, 'case-a')
})

test('formatDateLabel returns local date without shift', () => {
  const timestamp = Date.UTC(2025, 11, 14, 8, 9)
  const label = formatDateLabel(timestamp, { timeZone: 'Europe/Copenhagen' })
  assert.ok(label.startsWith('14-12-2025'))
})

test('normalizeHistoryEntry parses worker rate text into base range', () => {
  const entry = {
    id: 'case-b',
    payload: {
      notes: 'Timeløn pr. montør\nMedarbejder 1: 267,01 kr/t\nMedarbejder 2: 295,67 kr/t',
    },
  }
  const normalized = normalizeHistoryEntry(entry)
  assert.ok(normalized.wage.base)
  assert.equal(normalized.wage.base.min.toFixed(2), '267.01')
  assert.equal(normalized.wage.base.max.toFixed(2), '295.67')
  assert.equal(normalized.displayBaseWage, '267,01–295,67 kr/t')
})

test('normalizeHistoryList sorts newest entries first', () => {
  const entries = [
    { id: 'older', createdAt: 1000 },
    { id: 'newest', createdAt: 3000 },
    { id: 'mid', createdAt: 2000 },
  ]
  const normalized = normalizeHistoryList(entries)
  assert.deepEqual(normalized.map(entry => entry.id), ['newest', 'mid', 'older'])
})

test('precomputed display strings include address, hours and base wage', () => {
  const timestamp = Date.UTC(2025, 11, 14, 8, 9)
  const entry = {
    id: 'case-c',
    createdAt: timestamp,
    meta: { adresse: 'Hovedgaden 2' },
    hours: 7.5,
    totals: { hourlyBase: 267.01 },
  }
  const normalized = normalizeHistoryEntry(entry)
  assert.ok(normalized.displayDateWithAddress.includes('Hovedgaden 2'))
  assert.equal(normalized.displayHours, '7,5')
  assert.equal(normalized.displayBaseWage, '267,01 kr/t')
})

test('normalizeSearchValue strips accents for more forgiving search', () => {
  const folded = normalizeSearchValue('Østergade Århus')
  assert.equal(folded, 'ostergade arhus')
})
