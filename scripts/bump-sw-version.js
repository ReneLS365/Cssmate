import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const swPath = path.join(__dirname, '..', 'app', 'service-worker.js')

function formatVersionDate(date) {
  const parts = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
    'T',
    String(date.getUTCHours()).padStart(2, '0'),
    String(date.getUTCMinutes()).padStart(2, '0'),
    String(date.getUTCSeconds()).padStart(2, '0'),
    'Z'
  ]
  return parts.join('')
}

async function main() {
  const swSource = await readFile(swPath, 'utf8')
  const timestamp = formatVersionDate(new Date())
  const versionTag = `V-${timestamp}`
  const pattern = /const SW_VERSION = ".*?";?/
  if (!pattern.test(swSource)) {
    console.warn('bump-sw-version: SW_VERSION placeholder was not found – skipping update')
    return
  }

  const updatedSource = swSource.replace(pattern, `const SW_VERSION = "${versionTag}";`)
  await writeFile(swPath, updatedSource, 'utf8')
  console.log('bump-sw-version: Updated SW_VERSION to', versionTag)
}

main().catch(error => {
  console.error('bump-sw-version: Failed to bump service worker version', error)
  process.exitCode = 1
})
