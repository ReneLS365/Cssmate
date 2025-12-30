import fs from 'node:fs'
import path from 'node:path'

const DIST = 'dist'
const firebasePrefix = ['AI', 'za'].join('')
const RX = new RegExp(firebasePrefix)

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath)
      continue
    }
    const buf = fs.readFileSync(fullPath)
    const sample = buf.subarray(0, Math.min(buf.length, 8000))
    if (sample.includes(0)) continue
    const contents = buf.toString('utf8')
    if (RX.test(contents)) {
      console.error('❌ Firebase API key prefix found in dist:', fullPath)
      process.exit(2)
    }
  }
}

if (!fs.existsSync(DIST)) {
  console.log('ℹ️ dist/ not found, skipping dist scan')
  process.exit(0)
}

walk(DIST)
console.log('✅ dist clean')
