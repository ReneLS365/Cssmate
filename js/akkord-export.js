import { MATERIAL_SYSTEMS } from '../dataset.js'
import { getActiveJob } from '../src/state/jobs.js'

const SYSTEM_LABELS = new Map([
  ['bosta', 'BOSTA'],
  ['haki', 'HAKI'],
  ['modex', 'MODEX'],
  ['alfix', 'ALFIX'],
])

const MATERIAL_LOOKUP = Object.entries(MATERIAL_SYSTEMS).reduce((acc, [systemId, system]) => {
  const idMap = new Map()
  const nameMap = new Map()
  const items = Array.isArray(system.items) ? system.items : []
  items.forEach(item => {
    const idKey = normalizeMaterialId(item.id)
    if (idKey && !idMap.has(idKey)) {
      idMap.set(idKey, item)
    }
    const nameKey = normalizeMaterialName(item.name)
    if (nameKey && !nameMap.has(nameKey)) {
      nameMap.set(nameKey, item)
    }
  })
  acc[systemId] = { idMap, nameMap, label: system.label }
  return acc
}, {})

const KNOWN_SYSTEM_IDS = Object.keys(MATERIAL_LOOKUP)

function formatDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isNaN(date.valueOf())) {
    try {
      return new Intl.DateTimeFormat('da-DK').format(date)
    } catch {
      return date.toLocaleDateString('da-DK')
    }
  }
  return value
}

function toNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function inferSystemFromCode(value) {
  if (!value) return ''
  const code = String(value).trim().toLowerCase()
  if (code.startsWith('b')) return 'BOSTA'
  if (code.startsWith('h')) return 'HAKI'
  if (code.startsWith('m')) return 'MODEX'
  if (code.startsWith('a')) return 'ALFIX'
  return ''
}

function getSystemLabel(value) {
  if (!value) return ''
  const normalized = String(value).trim().toLowerCase()
  return SYSTEM_LABELS.get(normalized) || inferSystemFromCode(value) || value.toString().toUpperCase()
}

function normalizeMaterialId(value) {
  if (value === undefined || value === null) return ''
  return String(value).trim().toLowerCase()
}

function normalizeMaterialName(value) {
  if (value === undefined || value === null) return ''
  const base = String(value).trim().toLowerCase()
  if (!base) return ''
  try {
    return base
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
  } catch {
    return base
  }
}

function normalizeSystemKey(value) {
  if (value === undefined || value === null) return ''
  const normalized = String(value).trim().toLowerCase()
  if (!normalized) return ''
  if (MATERIAL_LOOKUP[normalized]) return normalized
  if (normalized.startsWith('b')) return 'bosta'
  if (normalized.startsWith('h')) return 'haki'
  if (normalized.startsWith('m')) return 'modex'
  if (normalized.startsWith('a')) return 'alfix'
  return ''
}

function getSystemCandidates(line, fallbackSystem) {
  const candidates = []
  const direct = normalizeSystemKey(line?.system || line?.systemKey)
  if (direct) candidates.push(direct)
  const fallback = normalizeSystemKey(fallbackSystem)
  if (fallback && !candidates.includes(fallback)) {
    candidates.push(fallback)
  }
  if (!direct) {
    const inferred = normalizeSystemKey(line?.id || line?.varenr)
    if (inferred && !candidates.includes(inferred)) {
      candidates.push(inferred)
    }
  }
  if (!candidates.length) return KNOWN_SYSTEM_IDS
  return candidates
}

function findMaterialMatch(line, fallbackSystem) {
  if (!line) return null
  const idKey = normalizeMaterialId(line.id || line.varenr)
  const nameKey = normalizeMaterialName(line.name || line.label || line.title)
  const candidates = getSystemCandidates(line, fallbackSystem)
  for (const systemId of candidates) {
    const lookup = MATERIAL_LOOKUP[systemId]
    if (!lookup) continue
    if (idKey && lookup.idMap.has(idKey)) {
      return { ...lookup.idMap.get(idKey), systemId }
    }
  }
  if (!nameKey) return null
  for (const systemId of candidates) {
    const lookup = MATERIAL_LOOKUP[systemId]
    if (!lookup) continue
    if (lookup.nameMap.has(nameKey)) {
      return { ...lookup.nameMap.get(nameKey), systemId }
    }
  }
  return null
}

function enrichLinesWithMaterialPrices(lines = [], fallbackSystem) {
  if (!Array.isArray(lines) || !lines.length) return []
  return lines.map(line => {
    if (!line) return line
    const price = Number(line.price ?? 0)
    if (price > 0) return line
    const match = findMaterialMatch(line, fallbackSystem)
    if (!match) return line
    return {
      ...line,
      price: match.price,
      unit: line.unit || match.unit || 'stk',
      system: line.system || getSystemLabel(match.systemId),
    }
  })
}

function normalizeLine(line, index = 0) {
  if (!line) return null
  const qty = toNumber(line.quantity ?? line.qty ?? line.amount ?? line.antal)
  if (!(qty > 0)) return null
  const unit = line.unit || line.enhed || 'stk'
  const name = line.name || line.label || line.title || ''
  if (!name) return null
  const price = toNumber(line.baseUnitPrice ?? line.unitPrice ?? line.price)
  const system = getSystemLabel(line.system || line.systemKey || inferSystemFromCode(line.varenr || line.id))
  return {
    id: line.id || line.varenr || `${index + 1}`,
    name,
    unit,
    price,
    qty,
    system,
  }
}

function normalizeLines(lines = []) {
  return lines
    .map((line, index) => normalizeLine(line, index))
    .filter(Boolean)
}

function extractTotals(source = {}) {
  const totals = source.totals || {}
  const extras = source.extras || {}
  return {
    materialsSum: toNumber(totals.materialer ?? totals.materialSum ?? 0),
    extrasSum: toNumber(totals.ekstraarbejde ?? totals.extrasSum ?? extras.extraSum ?? 0),
    kmSum: toNumber(totals.kilometerPris ?? totals.kmSum ?? extras.km ?? 0),
    hours: toNumber(totals.timer ?? totals.totalHours ?? 0),
    totalAkkord: toNumber(totals.akkordsum ?? totals.totalAkkord ?? 0),
  }
}

function buildJobFromMaterials(source, fallbackId = 'akkord') {
  if (!source) return null
  const info = source.sagsinfo || {}
  const systemHint = source.system || source.primarySystem || (Array.isArray(source.systems) ? source.systems[0] : '')
  const linesWithPrices = enrichLinesWithMaterialPrices(
    normalizeLines(
      Array.isArray(source.materialer)
        ? source.materialer
        : Array.isArray(source.materials)
          ? source.materials
          : source.lines || []
    ),
    systemHint
  )

  const job = {
    id: info.sagsnummer || source.id || fallbackId,
    name: info.navn || source.name || source.title || '',
    customer: info.kunde || source.customer || '',
    address: info.adresse || source.address || source.site || '',
    date: formatDate(info.dato || source.date || ''),
    system: getSystemLabel(
      source.system || source.primarySystem || (Array.isArray(source.systems) ? source.systems[0] : '')
    ),
    lines: linesWithPrices,
    totals: extractTotals(source),
  }

  if (!(job.totals.materialsSum > 0) && linesWithPrices.length) {
    job.totals.materialsSum = linesWithPrices.reduce((sum, line) => sum + (Number(line.qty) * Number(line.price) || 0), 0)
  }

  if (!job.system && linesWithPrices.length) {
    const firstSystem = linesWithPrices.find(line => line.system)?.system
    job.system = firstSystem || ''
  }

  if (!job.name) {
    job.name = job.address || job.customer || job.id || 'Akkordseddel'
  }

  return job
}

function getLatestEkompletData() {
  if (typeof window === 'undefined') return null
  return window.__cssmateLastEkompletData || null
}

function getRecentProjectEntries() {
  if (typeof window === 'undefined') return []
  const entries = window.__cssmateRecentProjects
  if (!Array.isArray(entries)) return []
  return entries
}

function findProjectById(id) {
  if (!id && id !== 0) return null
  const entries = getRecentProjectEntries()
  return entries.find(entry => {
    const entryId = entry?.id
    if (entryId === undefined || entryId === null) return false
    return String(entryId) === String(id)
  }) || null
}

function getSelectedProjectEntries() {
  if (typeof document === 'undefined') return []
  const selectors = Array.from(document.querySelectorAll('[data-job-select]'))
  if (!selectors.length) return []
  const selectedIds = selectors
    .filter(input => {
      const checked = input.checked || input.getAttribute('aria-checked') === 'true'
      return checked
    })
    .map(input => input.value ?? input.dataset.jobId ?? input.dataset.id)
    .filter(value => value !== undefined && value !== null)
  const unique = Array.from(new Set(selectedIds.map(value => String(value))))
  return unique
    .map(id => findProjectById(id))
    .filter(entry => entry && entry.data)
}

function buildJobFromProjectEntry(entry) {
  if (!entry) return null
  const source = entry.data || entry
  if (!source) return null
  const job = buildJobFromMaterials(source, entry.id ? `job-${entry.id}` : undefined)
  if (job && !job.date && entry.ts) {
    job.date = formatDate(entry.ts)
  }
  return job
}

function buildJobFromActiveState() {
  const data = getLatestEkompletData()
  if (data) {
    const job = buildJobFromMaterials(data)
    if (job) return job
  }
  const active = getActiveJob()
  if (active) {
    return buildJobFromMaterials(active, active.id || 'akkord')
  }
  return null
}

function resolveSelectedJobs() {
  const entries = getSelectedProjectEntries()
  if (!entries.length) return []
  return entries
    .map(entry => buildJobFromProjectEntry(entry))
    .filter(Boolean)
}

function resolveAllJobs() {
  const entries = getRecentProjectEntries()
  if (!entries.length) return []
  return entries
    .map(entry => buildJobFromProjectEntry(entry))
    .filter(Boolean)
}

export function getJobsForAkkordExport(options = { mode: 'current' }) {
  const mode = options?.mode || 'current'
  if (mode === 'selected') {
    const selected = resolveSelectedJobs()
    if (selected.length) return selected
    return []
  }
  if (mode === 'all') {
    const all = resolveAllJobs()
    if (all.length) return all
    return []
  }
  const current = buildJobFromActiveState()
  return current ? [current] : []
}

function buildAkkordPageHtml(job, index) {
  const systemLabel = job.system || 'Ukendt system'

  const linesHtml = (job.lines || []).map((line, i) => {
    const qty   = Number(line.qty || line.amount || 0)
    const unit  = line.unit || 'stk'
    const name  = line.name || line.title || ''
    const price = Number(line.price || 0)
    const lineTotal = qty * price
    const system = line.system || job.system || ''

    return `
      <tr>
        <td>${i + 1}</td>
        <td class="tal">${qty}</td>
        <td>${unit}</td>
        <td>${name}</td>
        <td class="tal">${price.toFixed(2)}</td>
        <td class="tal">${lineTotal.toFixed(2)}</td>
        <td>${system}</td>
      </tr>
    `
  }).join('')

  const alloc = job.akkordAlloc || {}
  const isPrimary = !!alloc.isPrimary

  // Lokale materialer
  const localMaterials = typeof alloc.materials === 'number'
    ? alloc.materials
    : (job.totals && typeof job.totals.materialsSum === 'number'
       ? job.totals.materialsSum
       : (job.lines || []).reduce((sum, line) => {
           const q = Number(line.qty || line.amount || 0)
           const p = Number(line.price || 0)
           return sum + q * p
         }, 0))

  // Global samlet materialesum (kun relevant for primær)
  const materialsGlobal = Number(alloc.materialsGlobal ?? 0)

  const extrasAllocated = Number(alloc.extrasAllocated ?? 0)
  const hoursAllocated  = Number(alloc.hoursAllocated ?? 0)
  const akkordTotal     = typeof alloc.akkordTotal === 'number'
    ? alloc.akkordTotal
    : (localMaterials + extrasAllocated)

  const hourlyRate = Number(alloc.hourlyRate ?? 0)
  const sharePct   = alloc.share ? (alloc.share * 100) : 0

  // Tekster til footer
  const globalMatLine = isPrimary && materialsGlobal
    ? `<p><strong>Samlet materialesum (alle sedler):</strong> ${materialsGlobal.toFixed(2)} kr.</p>`
    : ''

  const extrasLine = isPrimary
    ? `<p><strong>Slæb/tillæg/km/ekstra (samlet):</strong> ${extrasAllocated.toFixed(2)} kr.</p>`
    : `<p><strong>Slæb/tillæg/km/ekstra:</strong> (samlet på primær seddel)</p>`

  const hoursLine = isPrimary
    ? `<p><strong>Timer i alt:</strong> ${hoursAllocated.toFixed(2)} t</p>`
    : `<p><strong>Timer:</strong> (samlet på primær seddel)</p>`

  const hourlyLine = isPrimary && hourlyRate
    ? `<p><strong>Timeløn (akkord):</strong> ${hourlyRate.toFixed(2)} kr./t</p>`
    : `<p><strong>Timeløn (akkord):</strong> __________</p>`

  return `
    <section class="akkord-page">
      <header class="akkord-header">
        <div>
          <h1>Akkordseddel</h1>
          <p><strong>Job:</strong> ${job.name || ''}</p>
          <p><strong>Kunde:</strong> ${job.customer || ''}</p>
          <p><strong>Adresse:</strong> ${job.address || ''}</p>
        </div>
        <div>
          <p><strong>System:</strong> ${systemLabel}</p>
          <p><strong>Dato:</strong> ${job.date || ''}</p>
          <p><strong>Seddel nr.:</strong> ${index + 1}</p>
        </div>
      </header>

      <table class="akkord-table">
        <thead>
          <tr>
            <th>Pos.</th>
            <th>Antal</th>
            <th>Enhed</th>
            <th>Betegnelse</th>
            <th>Pris</th>
            <th>Beløb</th>
            <th>System</th>
          </tr>
        </thead>
        <tbody>
          ${linesHtml || '<tr><td colspan="7">Ingen linjer</td></tr>'}
        </tbody>
      </table>

      <div class="akkord-footer">
        <div class="akkord-sum">
          <p><strong>Materialesum (denne seddel):</strong> ${localMaterials.toFixed(2)} kr.</p>
          ${globalMatLine}
          ${extrasLine}
          <p><strong>Akkordsum for seddel:</strong> ${akkordTotal.toFixed(2)} kr.</p>
        </div>
        <div class="akkord-extra">
          ${hoursLine}
          ${hourlyLine}
          <p><strong>Andel af materialesum:</strong> ${sharePct.toFixed(1)} %</p>
        </div>
      </div>
    </section>
  `
}

export function computeGlobalAkkordTotals(jobs) {
  const initial = {
    materialsSum: 0,
    extrasSum: 0,
    kmSum: 0,
    otherExtraSum: 0,
    hoursSum: 0,
    totalAkkord: 0,
  }

  const totals = (jobs || []).reduce((acc, job) => {
    const t = job.totals || {}

    // Materialer
    const materials = typeof t.materialsSum === 'number'
      ? t.materialsSum
      : (job.lines || []).reduce((sum, line) => {
          const q = Number(line.qty || line.amount || 0)
          const p = Number(line.price || 0)
          return sum + q * p
        }, 0)

    acc.materialsSum += materials

    // Tillæg, km, ekstra – brug eksisterende felter hvis de findes, ellers 0
    acc.extrasSum     += Number(t.extrasSum ?? 0)      // generelle tillæg/procenter
    acc.kmSum         += Number(t.kmSum ?? 0)          // km-beløb
    acc.otherExtraSum += Number(t.otherExtraSum ?? 0)  // evt. “ekstra arbejde”

    // Timer
    acc.hoursSum      += Number(t.hours ?? t.totalHours ?? 0)

    // Samlet akkordsum (hvis det allerede er udregnet et sted)
    acc.totalAkkord   += Number(t.totalAkkord ?? 0)

    return acc
  }, initial)

  // Hvis totalAkkord ikke er sat, så beregn efter “materialer + tillæg + km + ekstra”
  const rawExtrasTotal = totals.extrasSum + totals.kmSum + totals.otherExtraSum
  const computedTotalAkkord = totals.materialsSum + rawExtrasTotal

  if (!totals.totalAkkord) {
    totals.totalAkkord = computedTotalAkkord
  }

  totals.rawExtrasTotal = rawExtrasTotal
  return totals
}

/**
 * Fordeler akkord-tal på tværs af jobs.
 *
 * KRAV:
 *  - Alle materialesummer beregnes pr. job.
 *  - Den SAMLEDE materialesum + tillæg/km/ekstra + timer
 *    lægges kun på ÉN primær seddel (index 0).
 *  - De øvrige sedler viser deres egen materialesum, men ingen fordelte tillæg/timer.
 *
 * Notation:
 *  - M_total = samlet materialesum
 *  - E_total = samlet tillæg/km/ekstra
 *  - H_total = samlede timer
 *  - A_total = M_total + E_total (eller totals.totalAkkord)
 */
function allocateAkkordAcrossJobs(jobs) {
  const totals = computeGlobalAkkordTotals(jobs)
  const M_total = totals.materialsSum
  const E_total = totals.rawExtrasTotal
  const H_total = totals.hoursSum

  const A_total = totals.totalAkkord || (M_total + E_total)
  const hourlyRate = H_total > 0 ? (A_total / H_total) : 0

  const primaryIndex = 0 // første seddel er primær

  const enrichedJobs = (jobs || []).map((job, idx) => {
    const t = job.totals || {}

    // Materialesum for DETTE job
    const materials = typeof t.materialsSum === 'number'
      ? t.materialsSum
      : (job.lines || []).reduce((sum, line) => {
          const q = Number(line.qty || line.amount || 0)
          const p = Number(line.price || 0)
          return sum + q * p
        }, 0)

    const share = M_total > 0 ? (materials / M_total) : 0

    // Primær seddel får ALLE globale tal
    if (idx === primaryIndex) {
      const jobExtras      = E_total
      const jobHours       = H_total
      const jobAkkordTotal = A_total

      return {
        ...job,
        akkordAlloc: {
          isPrimary: true,
          share,                 // andel af materialesum i %
          materials,             // materialesum for denne seddel (lokal)
          materialsGlobal: M_total, // samlet materialesum fra alle sedler
          extrasAllocated: jobExtras,
          hoursAllocated: jobHours,
          akkordTotal: jobAkkordTotal,
          hourlyRate,           // fælles timeløn baseret på total
        },
      }
    }

    // Øvrige sedler: viser kun egne materialer,
    // men ingen fordelte tillæg/timer.
    return {
      ...job,
      akkordAlloc: {
        isPrimary: false,
        share,
        materials,
        materialsGlobal: 0,
        extrasAllocated: 0,
        hoursAllocated: 0,
        akkordTotal: materials,
        hourlyRate: 0,
      },
    }
  })

  return {
    totals: {
      materialsTotal: M_total,
      extrasTotal: E_total,
      hoursTotal: H_total,
      akkordTotal: A_total,
      hourlyRate,
    },
    jobs: enrichedJobs,
  }
}

export function exportAkkord({ mode = 'current' } = {}) {
  const jobsRaw = getJobsForAkkordExport({ mode })
  if (!jobsRaw || !jobsRaw.length) {
    alert('Ingen akkordsedler valgt til eksport.')
    return
  }

  // Fordel/saml akkordtal på tværs af jobs
  const { jobs, totals } = allocateAkkordAcrossJobs(jobsRaw)

  const pagesHtml = jobs.map((job, idx) => buildAkkordPageHtml(job, idx)).join(`
    <div class="page-break"></div>
  `)

  const summaryHtml = `
    <section class="akkord-page">
      <h1>Samlet akkordoversigt</h1>
      <p><strong>Materialer i alt:</strong> ${totals.materialsTotal.toFixed(2)} kr.</p>
      <p><strong>Tillæg/km/ekstra i alt:</strong> ${totals.extrasTotal.toFixed(2)} kr.</p>
      <p><strong>Akkordsum i alt:</strong> ${totals.akkordTotal.toFixed(2)} kr.</p>
      <p><strong>Timer i alt:</strong> ${totals.hoursTotal.toFixed(2)} t</p>
      <p><strong>Timeløn (akkord):</strong> ${totals.hourlyRate.toFixed(2)} kr./t</p>
    </section>
  `

  const html = `
    <!doctype html>
    <html lang="da">
    <head>
      <meta charset="utf-8">
      <title>Akkordsedler</title>
      <style>
        body {
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          margin: 16px;
        }
        .akkord-page {
          margin-bottom: 12mm;
        }
        .akkord-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 12px;
        }
        .akkord-header h1 {
          margin: 0 0 4px 0;
          font-size: 20px;
        }
        .akkord-header p {
          margin: 0;
          font-size: 12px;
        }
        .akkord-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 11px;
          margin-bottom: 12px;
        }
        .akkord-table th,
        .akkord-table td {
          border: 1px solid #000;
          padding: 3px 4px;
        }
        .akkord-table th {
          text-align: left;
        }
        .akkord-table .tal {
          text-align: right;
          white-space: nowrap;
        }
        .akkord-footer {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          margin-top: 4px;
        }
        .akkord-sum p,
        .akkord-extra p {
          margin: 2px 0;
        }
        .page-break {
          page-break-after: always;
        }
        @media print {
          body {
            margin: 0;
          }
          .akkord-page {
            page-break-inside: avoid;
            padding: 12mm;
          }
        }
      </style>
    </head>
    <body>
      ${summaryHtml}
      <div class="page-break"></div>
      ${pagesHtml}
    </body>
    </html>
  `

  const win = window.open('', '_blank')
  if (!win) {
    alert('Kunne ikke åbne nyt vindue til print. Tillad pop-ups og prøv igen.')
    return
  }
  win.document.open()
  win.document.write(html)
  win.document.close()
  win.focus()
  win.print()
}
