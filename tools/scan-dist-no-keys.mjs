import fs from 'node:fs'
import path from 'node:path'

const DIST = 'dist'
const NETLIFY_PUBLISH = '.netlify_publish'
const firebasePrefix = ['AI', 'za'].join('')
const RX = new RegExp(firebasePrefix)

// Some output files are expected to contain Firebase client config (apiKey etc.)
// Keep scan strict for everything else.
const OUTPUT_ALLOWLIST = new Set([
  path.normalize('js/firebase-env.js'),
])

function isAllowlisted(fullPath, scanDir) {
  const rel = path.normalize(path.relative(scanDir, fullPath))
  return OUTPUT_ALLOWLIST.has(rel)
}

function walk(dir, scanDir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath, scanDir)
      continue
    }
    if (isAllowlisted(fullPath, scanDir)) continue
    const buf = fs.readFileSync(fullPath)
    const sample = buf.subarray(0, Math.min(buf.length, 8000))
    if (sample.includes(0)) continue
    const contents = buf.toString('utf8')
    if (RX.test(contents)) {
      console.error(`❌ Firebase API key prefix found in output (${path.basename(scanDir)}):`, fullPath)
      process.exit(2)
    }
  }
}

const distDir = path.resolve(process.cwd(), DIST)
const publishDir = path.resolve(process.cwd(), NETLIFY_PUBLISH)
const scanDir = fs.existsSync(distDir) ? distDir : (fs.existsSync(publishDir) ? publishDir : null)

if (!scanDir) {
  console.log('ℹ️ dist/ and .netlify_publish not found, skipping output scan')
  process.exit(0)
}

walk(scanDir, scanDir)
console.log(`✅ output clean (${path.basename(scanDir)})`)
