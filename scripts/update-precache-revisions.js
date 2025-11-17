import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const swPath = path.join(__dirname, '..', 'app', 'service-worker.js')
const appDir = path.join(__dirname, '..', 'app')

function computeRevision(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex')
}

function toJsonArray(source) {
  return source.replace(/([,{])(\w+):/g, '$1"$2":')
}

function fromManifest(manifest) {
  return `[${manifest
    .map(entry => {
      const revision = entry.revision === null ? 'null' : `"${entry.revision}"`
      return `{url:"${entry.url}",revision:${revision}}`
    })
    .join(',')}]`
}

async function loadManifest(source) {
  const match = source.match(/precacheAndRoute\((\[[^)]*\])/)
  if (!match) {
    throw new Error('precacheAndRoute manifest not found in service worker')
  }
  const manifestSource = match[1]
  const manifest = JSON.parse(toJsonArray(manifestSource))
  const start = match.index + match[0].indexOf(manifestSource)
  const end = start + manifestSource.length
  return { manifest, start, end }
}

async function refreshManifest() {
  const swSource = await readFile(swPath, 'utf8')
  const { manifest, start, end } = await loadManifest(swSource)

  for (const entry of manifest) {
    const assetPath = path.join(appDir, entry.url)
    try {
      const contents = await readFile(assetPath)
      entry.revision = computeRevision(contents)
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') {
        console.warn(`update-precache-revisions: ${entry.url} is missing – keeping existing revision`)
        continue
      }
      throw error
    }
  }

  const updatedArray = fromManifest(manifest)
  const updatedSource = swSource.slice(0, start) + updatedArray + swSource.slice(end)
  await writeFile(swPath, updatedSource, 'utf8')
  console.log('update-precache-revisions: refreshed revisions for', manifest.length, 'assets')
}

refreshManifest().catch(error => {
  console.error('update-precache-revisions: failed to refresh manifest', error)
  process.exitCode = 1
})
