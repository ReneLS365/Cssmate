import { buildExportModel } from '../../js/export-model.js'
import { ensureSheetJs } from '../features/export/sheetjs-loader.js'

const SUPPORTED_SYSTEMS = ['bosta', 'haki', 'modex']

export function getSystemDataset (systemId) {
  console.warn('getSystemDataset er ikke længere understøttet. Brug eksportmodellen i stedet.', systemId)
  return []
}

function sanitizeFilename (value) {
  return (value || 'akkordseddel')
    .toString()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9-_]+/gi, '_')
}

function getLatestJobSnapshot (jobOverride) {
  if (jobOverride) return jobOverride
  if (typeof window !== 'undefined' && window.__cssmateLastEkompletData) {
    return window.__cssmateLastEkompletData
  }
  return null
}

function normalizeSystem (value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function normalizeSystemList (value) {
  if (!value && value !== 0) return []
  const list = Array.isArray(value)
    ? value
    : (typeof value === 'string' || (value && typeof value[Symbol.iterator] === 'function')
        ? Array.from(value)
        : [value])
  const unique = []
  list.forEach(entry => {
    const normalized = normalizeSystem(entry)
    if (SUPPORTED_SYSTEMS.includes(normalized) && !unique.includes(normalized)) {
      unique.push(normalized)
    }
  })
  return unique
}

function resolveSystemsFromModel (model, override, sourceSystems) {
  const overrideList = normalizeSystemList(override)
  if (overrideList.length > 0) {
    return overrideList
  }

  const sourceList = normalizeSystemList(sourceSystems)
  if (sourceList.length > 0) {
    return sourceList
  }

  const metaSystem = normalizeSystem(model?.meta?.system)
  if (metaSystem && SUPPORTED_SYSTEMS.includes(metaSystem)) {
    return [metaSystem]
  }

  const itemSystems = Array.from(new Set((model?.items || [])
    .map(item => normalizeSystem(item.system))
    .filter(Boolean)
    .filter(system => SUPPORTED_SYSTEMS.includes(system))))

  if (itemSystems.length > 0) {
    return itemSystems
  }

  return ['']
}

function buildExcelFilename (model, system) {
  const caseNo = model?.meta?.caseNumber || 'sag'
  const safeCase = sanitizeFilename(caseNo) || 'sag'
  const label = (system || model?.meta?.system || '').toString().toUpperCase()
  return `Akkordseddel_${safeCase}_${label || 'SYSTEM'}.xlsx`
}

function encodeCellAddress (rowIndex, colIndex) {
  const colLetters = []
  let n = colIndex + 1
  while (n > 0) {
    const rem = (n - 1) % 26
    colLetters.unshift(String.fromCharCode(65 + rem))
    n = Math.floor((n - 1) / 26)
  }
  return `${colLetters.join('')}${rowIndex + 1}`
}

function formatNumber (value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

function filterItemsForSystem (items, system) {
  if (!system) return items
  const normalized = normalizeSystem(system)
  return items.filter(item => {
    const itemSystem = normalizeSystem(item.system)
    return !itemSystem || itemSystem === normalized
  })
}

function buildSheetRows (model, system) {
  const meta = model?.meta || {}
  const totals = model?.totals || {}
  const items = filterItemsForSystem(model?.items || [], system)
  const rows = []

  rows.push(['Akkordseddel'])
  rows.push([])

  const metaStart = rows.length
  const metaEntries = [
    ['Sagsnummer', meta.caseNumber || ''],
    ['Kunde', meta.customer || ''],
    ['Adresse', meta.address || ''],
    ['Navn/opgave', meta.caseName || ''],
    ['Dato', meta.date || ''],
    ['System', system || meta.system || ''],
  ]
  metaEntries.forEach(entry => rows.push(entry))

  rows.push([])
  const totalsStart = rows.length
  rows.push(['Materialer', formatNumber(totals.materials)])
  rows.push(['Ekstraarbejde', formatNumber(totals.extras)])
  rows.push(['Akkordsum', formatNumber(totals.akkord ?? totals.project)])
  rows.push(['Projektsum', formatNumber(totals.project ?? totals.akkord)])

  rows.push([])
  rows.push(['Varenr', 'Navn', 'Enhed', 'Antal', 'Stk pris', 'Linjetotal'])
  items.forEach(item => {
    rows.push([
      item.itemNumber || item.id || '',
      item.name || item.label || '',
      item.unit || 'stk',
      formatNumber(item.quantity ?? item.qty),
      formatNumber(item.unitPrice ?? item.price),
      formatNumber(item.lineTotal ?? item.total),
    ])
  })

  const caseCell = encodeCellAddress(metaStart, 1)
  const dateCell = encodeCellAddress(metaStart + 4, 1)
  return { rows, caseCell, dateCell, totalsRowStart: totalsStart }
}

function applyColumnWidths (sheet) {
  sheet['!cols'] = [
    { wch: 18 },
    { wch: 32 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 16 },
  ]
}

export function createWorkbookFromModel (model, system, xlsx) {
  if (!xlsx?.utils) throw new Error('Mangler XLSX utils til at bygge workbook')
  const { rows, caseCell, dateCell } = buildSheetRows(model, system)

  const sheet = xlsx.utils.aoa_to_sheet(rows)
  applyColumnWidths(sheet)

  sheet[caseCell] = { t: 's', v: String(model?.meta?.caseNumber || '') }
  sheet[dateCell] = { t: 's', v: (model?.meta?.date || '').toString().slice(0, 10) }

  const workbook = xlsx.utils.book_new()
  xlsx.utils.book_append_sheet(workbook, sheet, 'Akkordseddel')
  return workbook
}

async function exportModelAsExcel (model, options = {}) {
  const sourceSystems = options.sourceSystems || model?.meta?.systems || []
  const systems = resolveSystemsFromModel(model, options.systemOverride, sourceSystems)
  if (systems.length === 0) {
    console.warn('Excel-akkord eksport sprang over – ingen understøttede systemer valgt.')
    return []
  }

  let xlsx
  try {
    xlsx = options.xlsx || await ensureSheetJs()
  } catch (error) {
    console.error('Kunne ikke indlæse SheetJS til Excel eksport.', error)
    return []
  }

  const results = []
  systems.forEach(system => {
    try {
      const workbook = createWorkbookFromModel(model, system, xlsx)
      const output = xlsx.write(workbook, { bookType: 'xlsx', type: 'array' })
      const blob = new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      results.push({
        system,
        blob,
        fileName: buildExcelFilename(model, system),
      })
    } catch (error) {
      console.error('Excel-akkord eksport fejlede for system:', system, error)
    }
  })

  return results
}

export async function exportAkkordExcelForActiveJob (jobOverride, systemOverride) {
  const job = getLatestJobSnapshot(jobOverride)
  if (!job) {
    console.warn('Excel-akkord eksport sprang over – ingen aktive data.')
    return []
  }

  const model = buildExportModel(job, { exportedAt: new Date().toISOString() })
  return exportModelAsExcel(model, { systemOverride, sourceSystems: job?.excelSystems || job?.systems })
}

export async function exportExcelFromAkkordData (akkordData, systemOverride) {
  if (!akkordData) return []
  const model = buildExportModel(akkordData, { exportedAt: akkordData?.exportedAt })
  const sourceSystems = akkordData?.excelSystems || akkordData?.systems || akkordData?.meta?.systems
  return exportModelAsExcel(model, { systemOverride, sourceSystems })
}
