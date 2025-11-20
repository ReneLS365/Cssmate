import algoliasearch from 'algoliasearch'
import { MATERIAL_SYSTEMS } from '../app/dataset.js'

const {
  ALGOLIA_APP_ID,
  ALGOLIA_ADMIN_KEY,
  ALGOLIA_INDEX_NAME = 'cssmate_materials'
} = process.env

if (!ALGOLIA_APP_ID || !ALGOLIA_ADMIN_KEY) {
  console.error('Missing ALGOLIA_APP_ID or ALGOLIA_ADMIN_KEY in env vars')
  process.exit(1)
}

const client = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_ADMIN_KEY)
const index = client.initIndex(ALGOLIA_INDEX_NAME)

function buildRecords () {
  const systems = Object.values(MATERIAL_SYSTEMS || {})
  const records = []

  for (const system of systems) {
    if (!system || !system.items) continue
    const systemId = system.id || 'unknown'
    const systemLabel = system.label || systemId.toUpperCase()

    for (const item of system.items) {
      if (!item) continue
      const varenr = item.id || item.varenr || ''
      const name = item.name || item.navn || item.beskrivelse || ''
      const unit = item.unit || item.enhed || ''
      const price = Number(item.price ?? item.pris ?? 0) || 0
      const category = typeof item.category === 'string' ? item.category.trim().toLowerCase() : 'material'

      if (!varenr && !name) continue

      records.push({
        objectID: `${systemId}-${varenr || name}`,
        varenr,
        name,
        unit,
        price,
        category,
        systemId,
        systemLabel,
        searchText: `${name} ${varenr} ${systemLabel} ${category}`.trim()
      })
    }
  }

  return records
}

async function run () {
  const records = buildRecords()

  if (!records.length) {
    console.error('No material records built for Algolia')
    process.exit(1)
  }

  console.log(`Uploading ${records.length} materials to Algolia index "${ALGOLIA_INDEX_NAME}"...`)

  try {
    const res = await index.saveObjects(records, { autoGenerateObjectIDIfNotExist: false })
    console.log('Algolia upload complete:', res.objectIDs.length, 'objects')
  } catch (err) {
    console.error('Algolia upload failed:', err)
    process.exit(1)
  }
}

run()
