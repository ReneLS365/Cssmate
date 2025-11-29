import path from 'node:path'
import { stat, readdir, readFile } from 'node:fs/promises'
import { fixJsonFile } from './jsonFixer.js'
import { fixCsvFile } from './csvFixer.js'
import { fixXlsxFile } from './xlsxFixer.js'
import { fixZipFile } from './zipFixer.js'
import { FixReport } from './report.js'

const EXPORT_EXTENSIONS = ['.json', '.csv', '.xlsx', '.zip', '.pdf']

async function walkFiles (dir, files = []) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', '.git', '.cache'].includes(entry.name)) continue
      await walkFiles(fullPath, files)
    } else if (EXPORT_EXTENSIONS.includes(path.extname(entry.name).toLowerCase()) && !entry.name.endsWith('.bak')) {
      files.push(fullPath)
    }
  }
  return files
}

async function processFile (filePath, report) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.json') {
    const result = await fixJsonFile(filePath)
    report.addResult('json', result.status, result.message)
    return
  }
  if (ext === '.csv') {
    const result = await fixCsvFile(filePath)
    report.addResult('csv', result.status, result.message)
    return
  }
  if (ext === '.xlsx') {
    const result = await fixXlsxFile(filePath)
    report.addResult('xlsx', result.status, result.message)
    return
  }
  if (ext === '.zip') {
    const result = await fixZipFile(filePath)
    report.addResult('zip', result.status, result.message)
    return
  }
  if (ext === '.pdf') {
    try {
      const info = await stat(filePath)
      if (info.size <= 0) {
        report.addResult('pdf', 'warning', `${path.basename(filePath)} is empty`)
        return
      }
      const header = await readFile(filePath, { encoding: 'utf8' }).catch(() => '')
      if (typeof header === 'string' && header.slice(0, 4) === '%PDF') {
        report.addResult('pdf', 'ok', `${path.basename(filePath)} ok`)
      } else {
        report.addResult('pdf', 'warning', `${path.basename(filePath)} header not detected`)
      }
    } catch (error) {
      report.addResult('pdf', 'error', `${path.basename(filePath)}: ${error.message}`)
    }
  }
}

async function main () {
  const targetDir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('./exports')
  const report = new FixReport()
  try {
    const targetStats = await stat(targetDir)
    if (!targetStats.isDirectory()) {
      console.error(`Path is not a directory: ${targetDir}`)
      process.exit(1)
    }
  } catch (error) {
    console.error(`Cannot read directory: ${targetDir} (${error.message})`)
    process.exit(1)
  }

  const files = await walkFiles(targetDir)
  for (const filePath of files) {
    await processFile(filePath, report)
  }

  report.print()
}

main().catch(error => {
  console.error('Export auto-fix failed:', error)
  process.exit(1)
})
