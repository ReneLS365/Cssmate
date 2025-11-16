import { getActiveJob } from '../state/jobs.js'
import { BOSTA_DATA, HAKI_DATA, MODEX_DATA } from '../../dataset.js'
import { getTemplateBase64 } from './akkord-templates.js'

const XLSX_LIB_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm'
let xlsxLibPromise = null

async function ensureXlsxLib () {
  if (!xlsxLibPromise) {
    xlsxLibPromise = import(XLSX_LIB_URL).then(mod => mod?.default || mod)
  }
  return xlsxLibPromise
}

const SYSTEM_DATA = {
  bosta: BOSTA_DATA,
  haki: HAKI_DATA,
  modex: MODEX_DATA
}

function base64ToArrayBuffer (base64) {
  const clean = (base64 || '').replace(/\s+/g, '')

  if (!clean) return null

  if (typeof atob === 'function') {
    const binary = atob(clean)
    const len = binary.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i)
    return bytes.buffer
  }

  if (typeof Buffer === 'function') {
    return Buffer.from(clean, 'base64').buffer
  }

  throw new Error('Base64 decoding er ikke understøttet i dette miljø.')
}

async function loadTemplate (system, XLSX) {
  const base64 = getTemplateBase64(system)
  if (!base64) throw new Error('Ukendt system: ' + system)

  const buf = base64ToArrayBuffer(base64)
  if (!buf) throw new Error('Ingen template-data for system: ' + system)

  const wb = XLSX.read(buf, { type: 'array' })
  const wsName = wb.SheetNames[0]
  const ws = wb.Sheets[wsName]
  if (!ws) throw new Error('Mangler dataark i template for: ' + system)

  return { wb, ws }
}

function buildNameToQtyMap (system, job) {
  const map = new Map()
  const lines = job.lines || job.items || job.materials || []

  for (const line of lines) {
    if (line.system && line.system !== system) continue

    const label = (line.label || line.name || '').trim()
    const qty = Number(line.qty ?? line.amount ?? 0)
    if (!label || !qty) continue

    map.set(label, (map.get(label) || 0) + qty)
  }
  return map
}

function fillLinesGeneric (ws, nameToQty, XLSX) {
  if (!ws?.['!ref']) return
  const range = XLSX.utils.decode_range(ws['!ref'])

  for (let r = range.s.r; r <= range.e.r; r++) {
    const cellA = XLSX.utils.encode_cell({ r, c: 0 })
    const cellE = XLSX.utils.encode_cell({ r, c: 4 })

    const nameA = ws[cellA]?.v ? String(ws[cellA].v).trim() : ''
    const nameE = ws[cellE]?.v ? String(ws[cellE].v).trim() : ''

    if (nameA && nameToQty.has(nameA)) {
      const qty = nameToQty.get(nameA)
      const cellB = XLSX.utils.encode_cell({ r, c: 1 })
      const cellC = XLSX.utils.encode_cell({ r, c: 2 })
      const cellD = XLSX.utils.encode_cell({ r, c: 3 })

      ws[cellC] = { t: 'n', v: qty }
      ws[cellD] = { t: 'n', f: `${cellB}*${cellC}` }
    }

    if (nameE && nameToQty.has(nameE)) {
      const qty = nameToQty.get(nameE)
      const cellF = XLSX.utils.encode_cell({ r, c: 5 })
      const cellG = XLSX.utils.encode_cell({ r, c: 6 })
      const cellH = XLSX.utils.encode_cell({ r, c: 7 })

      ws[cellG] = { t: 'n', v: qty }
      ws[cellH] = { t: 'n', f: `${cellF}*${cellG}` }
    }
  }
}

function fillHeaderBosta (ws, job) {
  const montNames = job.montageWorkers || job.montNames || job.mont || ''
  const demoNames = job.demontageWorkers || job.demoNames || job.demo || ''

  ws.B2 = { t: 's', v: job.site || job.address || '' }
  ws.B3 = { t: 's', v: job.task || job.title || '' }
  ws.B4 = { t: 's', v: job.customer || '' }
  ws.B5 = { t: 's', v: job.caseNo || job.id || '' }
  ws.F2 = { t: 's', v: montNames }
  ws.F3 = { t: 's', v: demoNames }
  ws.F4 = { t: 's', v: job.date || new Date().toLocaleDateString('da-DK') }
}

function fillHeaderHaki (ws, job) {
  const montNames = job.montageWorkers || job.montNames || job.mont || ''
  const demoNames = job.demontageWorkers || job.demoNames || job.demo || ''
  const montor = job.montor || job.worker || ''

  ws.B2 = { t: 's', v: job.site || job.address || '' }
  ws.B3 = { t: 's', v: job.task || job.title || '' }
  ws.B4 = { t: 's', v: job.customer || '' }
  ws.B5 = { t: 's', v: job.caseNo || job.id || '' }
  ws.G2 = { t: 's', v: job.date || new Date().toLocaleDateString('da-DK') }
  ws.G3 = { t: 's', v: montNames }
  ws.G4 = { t: 's', v: demoNames }
  ws.G5 = { t: 's', v: montor }
}

function fillHeaderModex (ws, job) {
  const montNames = job.montageWorkers || job.montNames || job.mont || ''
  const demoNames = job.demontageWorkers || job.demoNames || job.demo || ''
  const montor = job.montor || job.worker || ''

  ws.B2 = { t: 's', v: job.site || job.address || '' }
  ws.B3 = { t: 's', v: job.task || job.title || '' }
  ws.B4 = { t: 's', v: job.customer || '' }
  ws.B5 = { t: 's', v: job.caseNo || job.id || '' }
  ws.B6 = { t: 's', v: montor }
  ws.F2 = { t: 's', v: job.date || new Date().toLocaleDateString('da-DK') }
  ws.F3 = { t: 's', v: montNames }
  ws.F4 = { t: 's', v: demoNames }
}

function fillHeaderGeneric (ws, job) {
  ws.B2 = { t: 's', v: job.site || job.address || '' }
  ws.B3 = { t: 's', v: job.task || job.title || '' }
  ws.B4 = { t: 's', v: job.customer || '' }
  ws.B5 = { t: 's', v: job.caseNo || job.id || '' }
  ws.F2 = { t: 's', v: job.date || new Date().toLocaleDateString('da-DK') }
}

function fillHeaderForSystem (system, ws, job) {
  if (system === 'bosta') return fillHeaderBosta(ws, job)
  if (system === 'haki') return fillHeaderHaki(ws, job)
  if (system === 'modex') return fillHeaderModex(ws, job)
  return fillHeaderGeneric(ws, job)
}

export async function exportAkkordExcelForActiveJob (systemOverride) {
  const job = getActiveJob()
  if (!job) {
    alert('Ingen aktiv sag valgt.')
    return
  }

  let system = (systemOverride || job.system || 'bosta').toLowerCase()
  const allowed = ['bosta', 'haki', 'modex']
  if (!allowed.includes(system)) {
    console.warn('Excel-akkord eksport springes over (system ikke understøttet):', system)
    return
  }

  try {
    const XLSX = await ensureXlsxLib()
    const { wb, ws } = await loadTemplate(system, XLSX)
    const nameToQty = buildNameToQtyMap(system, job)

    fillHeaderForSystem(system, ws, job)
    fillLinesGeneric(ws, nameToQty, XLSX)

    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const safeName = `${system}-${(job.caseNo || job.id || 'akkord')}.xlsx`
    a.download = safeName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (error) {
    console.error('Fejl under eksport af akkordseddel', error)
    alert('Kunne ikke eksportere akkordsedlen. Prøv igen eller kontakt support.')
  }
}

export function getSystemDataset (systemId) {
  return SYSTEM_DATA[systemId] || []
}
