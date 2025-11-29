import { readFile, writeFile, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { buildAkkordCSV } from '../../js/akkord-csv.js'
import { normalizeJsonModel } from './jsonFixer.js'

const BOM = '\ufeff'

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

async function findMatchingJsonPath (csvPath) {
  const dir = path.dirname(csvPath)
  const base = path.basename(csvPath, path.extname(csvPath))
  const candidates = [path.join(dir, `${base}.json`), path.join(dir, `${base}.JSON`)]
  for (const candidate of candidates) {
    try {
      await readFile(candidate, 'utf8')
      return candidate
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error
      }
    }
  }
  return null
}

export async function fixCsvFile (filePath, options = {}) {
  const baseName = path.basename(filePath)
  try {
    const jsonPath = options.jsonPath || await findMatchingJsonPath(filePath)
    if (jsonPath) {
      try {
        const jsonContent = await readFile(jsonPath, 'utf8')
        const parsed = JSON.parse(jsonContent)
        const model = normalizeJsonModel(parsed)
        const regenerated = buildAkkordCSV(model)
        await backupFile(filePath)
        await writeFile(filePath, regenerated, 'utf8')
        return { status: 'fixed', message: `${baseName} regenerated from JSON` }
      } catch (error) {
        return { status: 'warning', message: `${baseName}: kunne ikke regenerere fra JSON (${error.message})` }
      }
    }

    const content = await readFile(filePath)
    const text = content.toString('utf8')
    if (text.startsWith(BOM)) {
      return { status: 'ok', message: `${baseName} already UTF-8 BOM` }
    }
    await backupFile(filePath)
    await writeFile(filePath, BOM + text, 'utf8')
    return { status: 'fixed', message: `${baseName} BOM added` }
  } catch (error) {
    return { status: 'error', message: `${baseName}: ${error.message}` }
  }
}
