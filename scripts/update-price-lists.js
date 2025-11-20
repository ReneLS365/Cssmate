import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const datasetPath = path.join(__dirname, '..', 'app', 'dataset.js')
const priceSourcePath = path.join(__dirname, '..', 'app', 'complete_lists.json')

function normalizeLabel(value = '') {
  return value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function toNumber(value) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : 0
}

function escapeText(value = '') {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function formatNumber(value) {
  const numberValue = toNumber(value)
  if (Number.isInteger(numberValue)) {
    return String(numberValue)
  }
  return String(numberValue)
}

function renderArray(name, items) {
  const body = items
    .map(item => `  { varenr: '${escapeText(item.varenr)}', navn: '${escapeText(item.navn)}', enhed: '${escapeText(item.enhed)}', pris: ${formatNumber(item.pris)} },`)
    .join('\n')
  return `export const ${name} = [\n${body}\n];`
}

function replaceArrayBlock(source, name, block) {
  const pattern = new RegExp(`export const ${name} = \\[(?:[\\s\\S]*?)\\];`, 'm')
  if (!pattern.test(source)) {
    throw new Error(`Kunne ikke finde blokken for ${name} i dataset.js`)
  }
  return source.replace(pattern, block)
}

function applyPriceUpdates(target, sourceList) {
  const lookup = new Map(sourceList.map(entry => [normalizeLabel(entry.beskrivelse), toNumber(entry.pris)]))
  let updatedCount = 0
  const missing = []

  target.forEach(item => {
    const normalizedName = normalizeLabel(item.navn)
    if (lookup.has(normalizedName)) {
      const nextPrice = lookup.get(normalizedName)
      if (typeof nextPrice === 'number' && nextPrice !== item.pris) {
        item.pris = nextPrice
      }
      updatedCount += 1
    } else {
      missing.push(item.navn)
    }
  })

  return { updatedCount, missing }
}

async function main() {
  const [datasetModule, priceSource, datasetSource] = await Promise.all([
    import(pathToFileURL(datasetPath).href + `?version=${Date.now()}`),
    readFile(priceSourcePath, 'utf8'),
    readFile(datasetPath, 'utf8')
  ])

  const priceData = JSON.parse(priceSource)
  const systemMapping = [
    { key: 'BOSTA_DATA', label: 'Bosta' },
    { key: 'HAKI_DATA', label: 'HAKI' },
    { key: 'MODEX_DATA', label: 'MODEX' },
    { key: 'ALFIX_DATA', label: 'Alfix' }
  ]

  let summary = ''
  systemMapping.forEach(mapping => {
    const target = datasetModule[mapping.key]
    if (!Array.isArray(target)) {
      throw new Error(`Dataset mangler ${mapping.key}`)
    }
    const sourceList = priceData[mapping.label]
    if (!Array.isArray(sourceList)) {
      throw new Error(`Prislisten mangler ${mapping.label}`)
    }
    const { updatedCount, missing } = applyPriceUpdates(target, sourceList)
    summary += `\n${mapping.label}: ${updatedCount} priser opdateret, ${missing.length} uden match.`
    if (missing.length) {
      summary += `\n  Mangler: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`
    }
  })

  let nextSource = datasetSource
  systemMapping.forEach(mapping => {
    const block = renderArray(mapping.key, datasetModule[mapping.key])
    nextSource = replaceArrayBlock(nextSource, mapping.key, block)
  })

  await writeFile(datasetPath, nextSource, 'utf8')
  console.log('update-price-lists: dataset.js opdateret med nye priser.', summary)
}

main().catch(error => {
  console.error('update-price-lists: Fejl under prisopdatering', error)
  process.exitCode = 1
})
