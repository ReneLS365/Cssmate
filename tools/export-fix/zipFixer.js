import { readFile, writeFile, copyFile } from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { normalizeJsonModel } from './jsonFixer.js'
import { buildAkkordCSV } from '../../js/akkord-csv.js'
import { fixXlsxBuffer } from './xlsxFixer.js'

async function backupFile (filePath) {
  const backupPath = `${filePath}.bak`
  try {
    await copyFile(filePath, backupPath)
    return backupPath
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    return backupPath
  }
}

function loadJsonFromZip (zip, entryPath) {
  return zip.file(entryPath)?.async('string').then(content => JSON.parse(content))
}

export async function fixZipFile (filePath) {
  const baseName = path.basename(filePath)
  try {
    const buffer = await readFile(filePath)
    const zip = await JSZip.loadAsync(buffer)
    const jsonEntries = zip.filter(p => p.endsWith('.json'))
    const model = jsonEntries.length > 0 ? normalizeJsonModel(await loadJsonFromZip(zip, jsonEntries[0].name)) : null

    for (const entry of jsonEntries) {
      const normalized = model || normalizeJsonModel(await loadJsonFromZip(zip, entry.name))
      zip.file(entry.name, JSON.stringify(normalized, null, 2))
    }

    const csvEntries = zip.filter(p => p.endsWith('.csv'))
    if (model) {
      const csv = buildAkkordCSV(model)
      csvEntries.forEach(entry => {
        zip.file(entry.name, csv)
      })
    }

    const xlsxEntries = zip.filter(p => p.endsWith('.xlsx'))
    for (const entry of xlsxEntries) {
      const entryBuffer = await entry.async('nodebuffer')
      const result = fixXlsxBuffer(entryBuffer, { model, label: entry.name })
      if (result.status === 'fixed' && result.buffer) {
        zip.file(entry.name, result.buffer)
      }
    }

    const pdfEntries = zip.filter(p => p.endsWith('.pdf'))
    for (const entry of pdfEntries) {
      const size = entry._data?.uncompressedSize || 0
      if (size <= 0) {
        return { status: 'warning', message: `${baseName}: contains corrupt PDF` }
      }
    }

    const newBuffer = await zip.generateAsync({ type: 'nodebuffer' })
    await backupFile(filePath)
    await writeFile(filePath, newBuffer)
    return { status: 'fixed', message: `${baseName} repacked` }
  } catch (error) {
    return { status: 'error', message: `${baseName}: ${error.message}` }
  }
}
