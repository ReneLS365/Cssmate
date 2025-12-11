#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub)
  if (value && typeof value === 'object') {
    const next = {}
    for (const [key, val] of Object.entries(value)) {
      if (['exportedAt', 'id', 'uuid', 'jobId', 'appVersion', 'version'].includes(key)) continue
      next[key] = scrub(val)
    }
    return next
  }
  return value
}

function readJson(filePath) {
  const absolute = path.resolve(filePath)
  return JSON.parse(fs.readFileSync(absolute, 'utf8'))
}

const [file1, file2] = process.argv.slice(2)
if (!file1 || !file2) {
  console.error('Usage: node scripts/compare-json.js <export1.json> <export2.json>')
  process.exit(1)
}

const left = scrub(readJson(file1))
const right = scrub(readJson(file2))

if (JSON.stringify(left) !== JSON.stringify(right)) {
  console.error('JSON files differ after scrubbing volatile fields.')
  process.exit(2)
}

console.log('JSON files match after scrubbing volatile fields.')
