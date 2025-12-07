// AkkordExportV2 (kanonisk JSON-schema)
// {
//   version: '2.0',
//   source: 'cssmate',
//   meta: {
//     caseNumber, caseName, customer, address, date, system, systems, jobType,
//     jobFactor, createdAt, exportedAt
//   },
//   info: { sagsnummer, navn, adresse, kunde, dato, montoer, jobType },
//   items: [{ lineNumber, system, category, itemNumber, name, unit, quantity, unitPrice, lineTotal }],
//   extras: {
//     km: { quantity, rate, amount },
//     slaeb: { percent, amount },
//     tralle: { lifts35, lifts50, amount },
//     extraWork: [...],
//     fields: {
//       jobType, montagepris, demontagepris, slaebePct, slaebeFormulaText,
//       antalBoringHuller, antalLukHuller, antalBoringBeton, opskydeligtRaekvaerk,
//       kmBelob, kmAntal, kmIsAmount, traelle35, traelle50, tralleSum
//     }
//   },
//   wage: { workers: [...], totals: { hours, sum } },
//   extraInputs: {...},
//   totals: { materials, extras, extrasBreakdown, akkord, project }
// }
const NUMBER_FORMATTER = new Intl.NumberFormat('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function asNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function sanitizeDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10)
  const date = new Date(value)
  if (!Number.isNaN(date.valueOf())) return date.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function normalizeItems(data = {}) {
  const lines = Array.isArray(data.linjer) ? data.linjer : []
  if (lines.length > 0) {
    return lines
      .filter(line => line && asNumber(line.antal, 0) !== 0)
      .map((line, index) => {
        const quantity = asNumber(line.antal, 0)
        const unitPrice = asNumber(line.stkPris, 0)
        const lineTotal = asNumber(line.linjeBelob, quantity * unitPrice)
        return {
          lineNumber: line.linjeNr ?? index + 1,
          system: line.system || '',
          category: line.kategori || '',
          itemNumber: line.varenr || line.id || '',
          name: line.navn || '',
          unit: line.enhed || 'stk',
          quantity,
          unitPrice,
          lineTotal,
        }
      })
  }

  const materials = Array.isArray(data.materialer) ? data.materialer : []
  return materials
    .filter(entry => entry && asNumber(entry.quantity ?? entry.qty ?? entry.antal, 0) !== 0)
    .map((entry, index) => {
      const quantity = asNumber(entry.quantity ?? entry.qty ?? entry.antal, 0)
      const unitPrice = asNumber(entry.unitPrice ?? entry.ackUnitPrice ?? entry.baseUnitPrice ?? entry.pris, 0)
      const lineTotal = asNumber(entry.lineTotal ?? entry.linjeBelob ?? quantity * unitPrice, quantity * unitPrice)
      return {
        lineNumber: entry.linjeNr ?? entry.lineNumber ?? index + 1,
        system: entry.systemKey || entry.system || '',
        category: entry.kategori || '',
        itemNumber: entry.varenr || entry.id || '',
        name: entry.name || entry.label || '',
        unit: entry.enhed || 'stk',
        quantity,
        unitPrice,
        lineTotal,
      }
    })
}

function normalizeExtraWork(data = {}) {
  const list = Array.isArray(data.akkord?.ekstraarbejde)
    ? data.akkord.ekstraarbejde
    : []

  return list
    .filter(entry => entry)
    .map((entry, index) => ({
      id: entry.id || `extra-${index + 1}`,
      type: entry.type || 'Ekstraarbejde',
      quantity: asNumber(entry.antal, 0),
      unit: entry.enhed || '',
      rate: asNumber(entry.sats ?? entry.rate, 0),
      amount: asNumber(entry.belob, 0),
      description: entry.tekst || entry.note || '',
    }))
}

function normalizeTralle(data = {}) {
  const tralleState = data.tralleState || {}
  const extras = data.extras || {}
  const tralleSum = asNumber(data.tralleSum ?? extras.tralleSum ?? extras.tralle ?? 0, 0)
  return {
    lifts35: asNumber(tralleState.n35 ?? extras.traelle35 ?? extras.tralle35 ?? extras.tralleløft35, 0),
    lifts50: asNumber(tralleState.n50 ?? extras.traelle50 ?? extras.tralle50 ?? extras.tralleløft50, 0),
    amount: tralleSum,
  }
}

function normalizeWage(data = {}) {
  const workers = Array.isArray(data.laborTotals)
    ? data.laborTotals
    : Array.isArray(data.labor)
      ? data.labor
      : []

  const mapped = workers
    .map((worker, index) => {
      const hours = asNumber(worker.hours ?? worker.timer, 0)
      const rate = asNumber(worker.hourlyWithAllowances ?? worker.rate ?? worker.sats, 0)
      const total = worker.total != null
        ? asNumber(worker.total, 0)
        : asNumber(worker.beloeb ?? worker.belob ?? (hours * rate), 0)
      const name = worker.name || worker.navn || worker.montor || worker.montoer || `Medarbejder ${index + 1}`
      return {
        id: worker.id || `worker-${index + 1}`,
        name,
        hours,
        rate,
        total,
        allowances: {
          mentortillaeg: asNumber(worker.mentortillaeg, 0),
          udd: worker.udd || '',
        },
      }
    })
    .filter(entry => entry.hours > 0 || entry.total > 0)

  const totalHours = mapped.reduce((sum, worker) => sum + asNumber(worker.hours, 0), 0)
  const wageSum = mapped.reduce((sum, worker) => sum + asNumber(worker.total, 0), 0)

  return {
    workers: mapped,
    totals: {
      hours: totalHours,
      sum: wageSum,
    },
  }
}

export function buildExportModel(raw = {}, options = {}) {
  const metaInfo = { ...(raw.meta || {}), ...(raw.info || {}), ...(raw.sagsinfo || {}) }
  const akkord = raw.akkord || {}
  const extras = raw.extras || {}
  const extraInputs = raw.extraInputs || {}
  const totals = raw.totals || {}

  const items = normalizeItems(raw)
  const materials = items.map(item => ({
    id: item.itemNumber || item.id,
    name: item.name,
    qty: item.quantity,
    unitPrice: item.unitPrice,
    system: item.system,
  }))
  const extraWork = normalizeExtraWork(raw)
  const tralle = normalizeTralle(raw)

  const kmQuantity = asNumber(akkord.km ?? extras.kmAntal ?? extraInputs.km, 0)
  const kmAmount = asNumber(akkord.kmBelob ?? extras.kmBelob ?? extras.km, 0)
  const kmRate = kmQuantity ? kmAmount / kmQuantity : asNumber(akkord.kmSats ?? extras.kmSats, 0)

  const slaebPercent = asNumber(akkord.slaebProcent ?? extraInputs.slaebePctInput ?? extras.slaebePct, 0)
  const slaebAmount = asNumber(akkord.slaebBelob ?? extras.slaebBelob ?? extras.slaeb, 0)

  const extraWorkTotal = extraWork.reduce((sum, entry) => sum + asNumber(entry.amount, 0), 0)
  const extrasSumProvided = asNumber(totals.ekstraarbejde ?? totals.extraSum ?? totals.extrasSum, 0)
  const extrasSum = extrasSumProvided || (kmAmount + slaebAmount + tralle.amount + extraWorkTotal)

  const materialsSum = asNumber(
    totals.totalMaterialer ?? totals.materialer ?? totals.materialSum ?? akkord.totalMaterialer,
    items.reduce((sum, line) => sum + asNumber(line.lineTotal, 0), 0),
  )

  const akkordSum = asNumber(
    totals.totalAkkord
    ?? totals.projektsum
    ?? totals.samletAkkordsum
    ?? totals.akkordsum
    ?? akkord.totalAkkord,
    materialsSum + extrasSum,
  )

  const wage = normalizeWage(raw)

  const jobType = (raw.jobType || metaInfo.jobType || raw.type || 'montage').toLowerCase()
  const systems = Array.isArray(raw.systems)
    ? raw.systems
    : metaInfo.systems && Array.isArray(metaInfo.systems)
      ? metaInfo.systems
      : metaInfo.system
        ? [metaInfo.system]
        : raw.system
          ? [raw.system]
          : []

  const meta = {
    version: '2.0',
    source: 'cssmate',
    caseNumber: metaInfo.caseNumber || metaInfo.sagsnummer || metaInfo.caseNo || 'UKENDT',
    caseName: metaInfo.caseName || metaInfo.navn || metaInfo.beskrivelse || raw.info?.navn || '',
    customer: metaInfo.customer || metaInfo.kunde || raw.info?.kunde || '',
    address: metaInfo.address || metaInfo.adresse || raw.info?.adresse || '',
    date: sanitizeDate(metaInfo.date || metaInfo.dato || raw.info?.dato || raw.createdAt),
    system: systems[0] || '',
    systems,
    jobType,
    jobFactor: asNumber(raw.jobFactor, 1) || 1,
    createdAt: raw.createdAt || metaInfo.createdAt || new Date().toISOString(),
    exportedAt: options.exportedAt || new Date().toISOString(),
  }

  const info = {
    sagsnummer: meta.caseNumber,
    navn: meta.caseName,
    adresse: meta.address,
    kunde: meta.customer,
    dato: meta.date,
    montoer: metaInfo.montoer || raw.info?.montoer || '',
    jobType,
  }

  const extraFields = {
    jobType,
    montagepris: extras.montagepris,
    demontagepris: extras.demontagepris,
    slaebePct: slaebPercent,
    slaebeFormulaText: extras.slaebeFormulaText,
    antalBoringHuller: extras.antalBoringHuller ?? extraInputs.boringHuller ?? extras.huller ?? 0,
    antalLukHuller: extras.lukAfHul ?? extras.antalLukHuller ?? extraInputs.lukHuller ?? 0,
    antalBoringBeton: extras.boringBeton ?? extras.antalBoringBeton ?? extraInputs.boringBeton ?? 0,
    opskydeligtRaekvaerk: extras.opskydeligt ?? extras.opskydeligtRaekvaerk ?? extraInputs.opskydeligt ?? 0,
    kmBelob: kmAmount,
    kmAntal: kmQuantity,
    kmIsAmount: true,
    traelle35: tralle.lifts35,
    traelle50: tralle.lifts50,
    tralleSum: tralle.amount,
  }

  const extraInputsModel = {
    ...extraInputs,
    km: extraInputs.km ?? kmQuantity,
    slaebePctInput: extraInputs.slaebePctInput ?? slaebPercent,
    boringHuller: extraInputs.boringHuller ?? extraFields.antalBoringHuller,
    lukHuller: extraInputs.lukHuller ?? extraFields.antalLukHuller,
    boringBeton: extraInputs.boringBeton ?? extraFields.antalBoringBeton,
    opskydeligt: extraInputs.opskydeligt ?? extraFields.opskydeligtRaekvaerk,
  }

  const totalsModel = {
    materials: materialsSum,
    extras: extrasSum,
    extrasBreakdown: {
      km: kmAmount,
      slaeb: slaebAmount,
      tralle: tralle.amount,
      extraWork: extraWorkTotal,
    },
    akkord: akkordSum,
    project: asNumber(totals.projektsum ?? totals.project, akkordSum),
  }

  const model = {
    version: '2.0',
    source: 'cssmate',
    meta,
    info,
    materials,
    items,
    extras: {
      km: { quantity: kmQuantity, rate: kmRate, amount: kmAmount },
      slaeb: { percent: slaebPercent, amount: slaebAmount },
      tralle,
      extraWork,
      fields: extraFields,
    },
    wage,
    extraInputs: extraInputsModel,
    totals: totalsModel,
  }

  return model
}

export function formatDkk(value) {
  return NUMBER_FORMATTER.format(asNumber(value, 0))
}

export function formatCsvNumber(value) {
  return NUMBER_FORMATTER.format(asNumber(value, 0))
}
