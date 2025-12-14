const DEFAULT_TILLAEG_UDD1 = 42.98
const DEFAULT_TILLAEG_UDD2 = 49.38
const DEFAULT_MENTOR_RATE = 22.26

function toNumber (value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (value == null) return 0
  const stringValue = String(value).trim()
  if (!stringValue) return 0
  const compactValue = stringValue.replace(/\s+/g, '').replace(/'/g, '')
  const separators = compactValue.match(/[.,]/g) || []
  let normalized = compactValue.replace(/[^0-9.,-]/g, '')
  if (separators.length > 1) {
    const lastSeparator = separators[separators.length - 1]
    const decimalIndex = normalized.lastIndexOf(lastSeparator)
    const integerPart = normalized.slice(0, decimalIndex).replace(/[.,]/g, '').replace(/(?!^)-/g, '')
    const fractionalPart = normalized.slice(decimalIndex + 1).replace(/[^0-9]/g, '')
    normalized = `${integerPart || '0'}.${fractionalPart}`
  } else if (separators.length === 1) {
    if (/^-?\d{1,3}(?:[.,]\d{3})+$/.test(normalized)) {
      normalized = normalized.replace(/[.,]/g, '').replace(/(?!^)-/g, '')
    } else {
      const separator = separators[0]
      const decimalIndex = normalized.lastIndexOf(separator)
      const integerPart = normalized.slice(0, decimalIndex).replace(/[.,]/g, '').replace(/(?!^)-/g, '')
      const fractionalPart = normalized.slice(decimalIndex + 1).replace(/[^0-9]/g, '')
      normalized = `${integerPart || '0'}.${fractionalPart}`
    }
  } else {
    normalized = normalized.replace(/(?!^)-/g, '')
  }
  const num = Number.parseFloat(normalized)
  return Number.isFinite(num) ? num : 0
}

function formatCurrency (value) {
  return new Intl.NumberFormat('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0)
}

function formatHours (value) {
  return new Intl.NumberFormat('da-DK', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value || 0)
}

function formatDateLabel (timestamp, { timeZone } = {}) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.valueOf())) return ''
  try {
    const formatter = new Intl.DateTimeFormat('da-DK', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      ...(timeZone ? { timeZone } : {}),
    })
    const parts = formatter.formatToParts(date)
    const lookup = Object.fromEntries(parts.map(part => [part.type, part.value]))
    return `${lookup.day || ''}-${lookup.month || ''}-${lookup.year || ''} ${lookup.hour || '00'}:${lookup.minute || '00'}`.trim()
  } catch {
    return date.toLocaleString('da-DK')
  }
}

function normalizeSearchValue (value) {
  return (value || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function pickNumber (candidates = []) {
  for (const value of candidates) {
    const num = toNumber(value)
    if (num > 0) return num
  }
  return 0
}

function buildWageRange (value) {
  if (!value && value !== 0) return null
  if (typeof value === 'object' && value != null) {
    const min = toNumber(value.min)
    const max = toNumber(value.max)
    if (min > 0 && max > 0) {
      return { min: Math.min(min, max), max: Math.max(min, max) }
    }
  }
  const num = toNumber(value)
  if (num > 0) return { min: num, max: num }
  return null
}

function formatWageRange (range) {
  if (!range) return '–'
  if (range.min === range.max) return `${formatCurrency(range.min)} kr/t`
  return `${formatCurrency(range.min)}–${formatCurrency(range.max)} kr/t`
}

function deriveMetaFromEntry (entry = {}) {
  const meta = entry.meta || {}
  const info = entry.data?.sagsinfo || entry.payload?.job?.info || entry.payload?.info || entry.payload?.meta || {}
  return {
    sagsnummer: meta.sagsnummer || info.sagsnummer || info.caseNumber || '',
    navn: meta.navn || info.navn || info.opgave || info.title || '',
    adresse: meta.adresse || info.adresse || info.address || info.site || '',
    kunde: meta.kunde || info.kunde || info.customer || '',
    dato: meta.dato || info.dato || info.date || '',
    montoer: meta.montoer || info.montoer || info.worker || info.montor || '',
  }
}

function extractWorkerRates (entry = {}) {
  const workerSources = [
    entry?.data?.job?.wage?.workers,
    entry?.payload?.job?.wage?.workers,
    entry?.data?.wage?.workers,
    entry?.payload?.wage?.workers,
    entry?.data?.laborTotals,
    entry?.data?.labor,
    entry?.payload?.labor,
  ]
  const workers = workerSources.find(Array.isArray) || []
  const parsed = workers
    .map((worker, index) => {
      const name = worker?.name || worker?.navn || worker?.montor || worker?.montoer || `Montør ${index + 1}`
      const base = toNumber(worker?.hourlyBase ?? worker?.akkordTimeLon ?? worker?.timeprisUdenTillaeg ?? worker?.baseRate)
      const rate = toNumber(
        worker?.hourlyWithAllowances ?? worker?.rate ?? worker?.sats ?? worker?.hourlyRate ?? worker?.timeprisMedTillaeg ?? worker?.hourly ?? worker?.belobPerTime
      )
      return { name, base, rate }
    })
    .filter(worker => worker.name || worker.rate > 0 || worker.base > 0)

  if (parsed.length) return parsed

  const textFields = [entry?.payload?.notes, entry?.notes, entry?.meta?.notes].filter(Boolean)
  for (const text of textFields) {
    const lines = String(text).split(/\n+/)
    const candidates = []
    lines.forEach((line, index) => {
      const matches = Array.from(line.matchAll(/([-+]?\d+[\d.,]*)/g))
      const valueMatch = matches.length ? matches[matches.length - 1][1] : null
      if (!valueMatch) return
      const value = toNumber(valueMatch)
      if (!(value > 0)) return
      const nameMatch = line.replace(valueMatch, '').replace(/[:|\-]/g, '').trim()
      const name = nameMatch || `Montør ${index + 1}`
      candidates.push({ name, base: 0, rate: value })
    })
    if (candidates.length) return candidates
  }

  return []
}

function expandAllowanceRange (baseRange, allowance) {
  if (!baseRange || !(allowance > 0)) return null
  return { min: baseRange.min + allowance, max: baseRange.max + allowance }
}

function resolveTimestamp (entry = {}) {
  const candidates = [
    entry.createdAtMs,
    entry.updatedAtMs,
    entry.createdAt,
    entry.updatedAt,
    entry.ts,
    entry.timestamp,
    entry.data?.timestamp,
    entry.payload?.timestamp,
  ]
  for (const candidate of candidates) {
    const value = toNumber(candidate)
    if (value) return value
  }
  if (entry.updatedAt || entry.createdAt) return Date.parse(entry.updatedAt || entry.createdAt)
  return 0
}

const cache = new Map()

function normalizeHistoryEntry (entry, options = {}) {
  if (!entry) return null
  const timestamp = resolveTimestamp(entry)
  const timeZone = entry.timeZone || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined)
  const tzOffsetMin = Number.isFinite(entry.tzOffsetMin) ? entry.tzOffsetMin : new Date(timestamp || Date.now()).getTimezoneOffset()
  const cacheKey = `${entry.id || entry.caseKey || entry.meta?.sagsnummer || 'history'}:${timestamp}`
  if (cache.has(cacheKey)) return cache.get(cacheKey)

  const meta = deriveMetaFromEntry(entry)
  const totals = entry.totals || entry.data?.totals || entry.payload?.totals || {}
  const hours = pickNumber([entry.hours, totals.timer, totals.totalHours, totals.timerTotal, entry.data?.timer])

  const workerRates = extractWorkerRates(entry)
  const baseFromWorkers = workerRates.length
    ? {
        min: Math.min(...workerRates.map(worker => toNumber(worker.base || worker.rate)).filter(value => value > 0)),
        max: Math.max(...workerRates.map(worker => toNumber(worker.base || worker.rate)).filter(value => value > 0)),
      }
    : null

  const safeBaseFromWorkers = baseFromWorkers && Number.isFinite(baseFromWorkers.min) && Number.isFinite(baseFromWorkers.max)
    ? { min: baseFromWorkers.min, max: baseFromWorkers.max }
    : null

  const baseRange = buildWageRange(
    pickNumber([
      totals.hourlyBase,
      totals.timeprisUdenTillaeg,
      totals.akkordTimeLon,
      totals.baseHourly,
      entry.hourlyBase,
      entry.base,
    ])
  ) || safeBaseFromWorkers

  const tillaegUdd1 = toNumber(options.tillaegUdd1 ?? DEFAULT_TILLAEG_UDD1)
  const tillaegUdd2 = toNumber(options.tillaegUdd2 ?? DEFAULT_TILLAEG_UDD2)
  const mentorRate = toNumber(options.mentorRate ?? DEFAULT_MENTOR_RATE)

  const udd1Range = buildWageRange(pickNumber([totals.hourlyUdd1, totals.udd1])) || expandAllowanceRange(baseRange, tillaegUdd1)
  const udd2Range = buildWageRange(pickNumber([totals.hourlyUdd2, totals.udd2])) || expandAllowanceRange(baseRange, tillaegUdd2)
  const udd2MentorRange = buildWageRange(pickNumber([totals.hourlyUdd2Mentor, totals.udd2Mentor]))
    || (baseRange ? { min: baseRange.min + tillaegUdd2 + mentorRate, max: baseRange.max + tillaegUdd2 + mentorRate } : null)

  const dateDisplay = formatDateLabel(timestamp, { timeZone })
  const addressText = meta.adresse?.trim() || ''
  const displayDateWithAddress = addressText ? `${dateDisplay} · ${addressText}` : dateDisplay

  const normalized = {
    ...entry,
    id: entry.id || entry.caseKey || `history-${timestamp || Date.now()}`,
    createdAt: timestamp,
    updatedAt: timestamp,
    meta,
    hours,
    wage: {
      base: baseRange,
      udd1: udd1Range,
      udd2: udd2Range,
      udd2Mentor: udd2MentorRange,
    },
    perWorker: workerRates,
    timeZone,
    tzOffsetMin,
    displayDate: dateDisplay,
    displayDateWithAddress,
    displayHours: hours ? formatHours(hours) : '',
    displayBaseWage: formatWageRange(baseRange),
    display: {
      base: formatWageRange(baseRange),
      udd1: formatWageRange(udd1Range),
      udd2: formatWageRange(udd2Range),
      udd2Mentor: formatWageRange(udd2MentorRange),
    },
  }

  const searchValues = [meta.sagsnummer, meta.navn, meta.kunde, meta.adresse, meta.montoer]
    .filter(Boolean)
    .map(value => normalizeSearchValue(value))
  searchValues.push(normalizeSearchValue(dateDisplay), normalizeSearchValue(displayDateWithAddress))
  const searchTotal = pickNumber([totals.projektsum, totals.projectTotal, totals.total, totals.sum])
  if (searchTotal) {
    searchValues.push(normalizeSearchValue(formatCurrency(searchTotal)))
  }
  workerRates.forEach(worker => {
    if (worker?.name) {
      searchValues.push(normalizeSearchValue(worker.name))
    }
  })
  normalized.searchValues = Array.from(new Set(searchValues.filter(Boolean)))

  cache.set(cacheKey, normalized)
  return normalized
}

function normalizeHistoryList (entries = [], options = {}) {
  const sorted = (Array.isArray(entries) ? entries : [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => resolveTimestamp(b) - resolveTimestamp(a))
  return sorted
    .map(entry => normalizeHistoryEntry(entry, options))
    .filter(Boolean)
}

export {
  normalizeHistoryEntry,
  normalizeHistoryList,
  formatDateLabel,
  normalizeSearchValue,
  DEFAULT_TILLAEG_UDD1,
  DEFAULT_TILLAEG_UDD2,
  DEFAULT_MENTOR_RATE,
}
