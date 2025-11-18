import { getActiveJob } from '../src/state/jobs.js'

const SYSTEM_LABELS = new Map([
  ['bosta', 'BOSTA'],
  ['haki', 'HAKI'],
  ['modex', 'MODEX'],
  ['alfix', 'ALFIX'],
])

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

function cloneJob(job) {
  if (!job) return null
  return JSON.parse(JSON.stringify(job))
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
  const lines = normalizeLines(
    Array.isArray(source.materialer)
      ? source.materialer
      : Array.isArray(source.materials)
        ? source.materials
        : source.lines || []
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
    lines,
    totals: extractTotals(source),
  }

  if (!(job.totals.materialsSum > 0) && lines.length) {
    job.totals.materialsSum = lines.reduce((sum, line) => sum + (Number(line.qty) * Number(line.price) || 0), 0)
  }

  if (!job.system && lines.length) {
    const firstSystem = lines.find(line => line.system)?.system
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
    return cloneJob(active)
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
    const qty = Number(line.qty ?? line.quantity ?? 0)
    const unit = line.unit || 'stk'
    const name = line.name || ''
    const price = Number(line.price ?? 0)
    const lineTotal = qty * price
    const system = line.system || ''
    return `
      <tr>
        <td>${i + 1}</td>
        <td class="tal">${qty.toLocaleString('da-DK')}</td>
        <td>${unit}</td>
        <td>${name}</td>
        <td class="tal">${price.toFixed(2)}</td>
        <td class="tal">${lineTotal.toFixed(2)}</td>
        <td>${system}</td>
      </tr>
    `
  }).join('')

  const materialsSum = job.totals?.materialsSum ?? (job.lines || []).reduce((sum, line) => {
    const q = Number(line.qty ?? 0)
    const p = Number(line.price ?? 0)
    return sum + (Number.isFinite(q * p) ? q * p : 0)
  }, 0)

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
          <p><strong>Materialesum:</strong> ${materialsSum.toFixed(2)} kr.</p>
        </div>
        <div class="akkord-extra">
          <p><strong>Tillæg (%):</strong> __________</p>
          <p><strong>Km:</strong> __________</p>
          <p><strong>Ekstra arbejde:</strong> __________</p>
          <p><strong>Timer i alt:</strong> __________</p>
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
    hoursSum: 0,
    totalAkkord: 0,
  }

  return (jobs || []).reduce((acc, job) => {
    const t = job?.totals || {}
    acc.materialsSum += Number(t.materialsSum ?? 0)
    acc.extrasSum += Number(t.extrasSum ?? 0)
    acc.kmSum += Number(t.kmSum ?? 0)
    acc.hoursSum += Number(t.hours ?? 0)
    acc.totalAkkord += Number(t.totalAkkord ?? 0)
    return acc
  }, initial)
}

export function exportAkkord({ mode = 'current' } = {}) {
  const jobs = getJobsForAkkordExport({ mode })
  if (!jobs || !jobs.length) {
    alert('Ingen akkordsedler valgt til eksport.')
    return
  }

  const pagesHtml = jobs.map((job, idx) => buildAkkordPageHtml(job, idx)).join(`
    <div class="page-break"></div>
  `)

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
