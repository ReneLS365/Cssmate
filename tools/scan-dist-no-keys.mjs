import fs from 'node:fs'
import path from 'node:path'

const DIST = 'dist'
const RX = /AIza/

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath)
      continue
    }
    const contents = fs.readFileSync(fullPath, 'utf8')
    if (RX.test(contents)) {
      console.error('❌ API key found in dist:', fullPath)
      process.exit(2)
    }
  }
}

walk(DIST)
console.log('✅ dist clean')
