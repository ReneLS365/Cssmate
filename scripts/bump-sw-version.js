import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const swPath = path.join(__dirname, '..', 'service-worker.js')

function formatVersionTag(date = new Date()) {
  const stamp = date.toISOString().replace(/[-:.TZ]/g, '')
  return `sscaff-v-${stamp}`
}

async function main() {
  const swSource = await readFile(swPath, 'utf8')
  const versionPattern = /const CACHE_VERSION = ['"].*?['"]/m
  if (!versionPattern.test(swSource)) {
    console.warn('bump-sw-version: CACHE_VERSION placeholder not found – skipping update')
    return
  }

  const nextTag = formatVersionTag()
  const updatedSource = swSource.replace(versionPattern, `const CACHE_VERSION = '${nextTag}'`)
  await writeFile(swPath, updatedSource, 'utf8')
  console.log('bump-sw-version: Updated CACHE_VERSION to', nextTag)
}

main().catch(error => {
  console.error('bump-sw-version: Failed to bump service worker version', error)
  process.exitCode = 1
})
