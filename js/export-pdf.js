import { ensureExportLibs } from '../src/features/export/lazy-libs.js'
import { buildExportModel, formatDkk } from './export-model.js'
import { H, MARGIN, PAGE, createLayoutCursor } from './pdf/layout-cursor.js'

const CONTENT_WIDTH = PAGE.w - MARGIN * 2

const COLS_MATERIAL = { idx: 24, sys: 56, name: 243, qty: 56, price: 64, sum: 80.28 }
const COLS_WAGE = { who: 205, hrs: 58, rate: 120, sum: 140.28 }
const COLS_SUMMARY = { label: 343.28, value: 180 }

const TITLE_FONT = 16
const SECTION_FONT = 12
const BODY_FONT = 10.5

const PREF_SYSTEM_ORDER = ['bosta', 'haki', 'modex']

const NUMBER_FORMATTER = new Intl.NumberFormat('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function formatNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? NUMBER_FORMATTER.format(num) : '0,00'
}

function formatKr(value) {
  return `${formatDkk(value)} kr`
}

function formatKrPerHour(value) {
  return `${formatDkk(value)} kr/t`
}

function formatHours(value) {
  return formatNumber(value)
}

function formatQty(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return '0'
  return Number.isInteger(num) ? String(num) : NUMBER_FORMATTER.format(num)
}

function formatDateTime(ts) {
  const date = ts ? new Date(ts) : new Date()
  const pad = (v) => String(v).padStart(2, '0')
  const day = pad(date.getDate())
  const month = pad(date.getMonth() + 1)
  const year = date.getFullYear()
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  return `${day}.${month}.${year} ${hours}:${minutes}`
}

function toNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

function sanitizeFilename(value) {
  return (value || 'akkord')
    .toString()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9-_]+/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function buildPdfModel(raw = {}) {
  const baseModel = raw?.meta && raw?.totals ? raw : buildExportModel(raw)
  const meta = baseModel.meta || {}
  const info = baseModel.info || {}
  const wage = baseModel.wage || {}
  const extras = baseModel.extras || {}
  const totals = baseModel.totals || {}
  const breakdown = totals.extrasBreakdown || {}
  const comment = (meta.comment || info.comment || '').toString()

  const materialItems = Array.isArray(baseModel.items) ? baseModel.items : []
  const mappedMaterials = materialItems
    .map((item, index) => ({
      idx: item.lineNumber || index + 1,
      system: item.system || meta.system || '',
      name: item.name || item.itemNumber || '',
      qty: toNumber(item.quantity),
      unitPrice: toNumber(item.unitPrice),
      lineTotal: toNumber(item.lineTotal ?? item.quantity * item.unitPrice),
    }))
    .filter(entry => entry.qty !== 0 || entry.lineTotal !== 0)

  const systemOrder = (Array.isArray(meta.systems) ? meta.systems : [])
    .map(s => s?.toString() || '')
    .filter(Boolean)
  const systemOrderMap = new Map()
  systemOrder.forEach((name, idx) => systemOrderMap.set(name.toLowerCase(), idx))

  const sortedMaterials = mappedMaterials.sort((a, b) => {
    const sysA = (a.system || '').toString()
    const sysB = (b.system || '').toString()
    const normA = sysA.toLowerCase()
    const normB = sysB.toLowerCase()
    const preferredA = PREF_SYSTEM_ORDER.indexOf(normA)
    const preferredB = PREF_SYSTEM_ORDER.indexOf(normB)
    if (preferredA !== preferredB) return preferredA - preferredB
    const orderA = systemOrderMap.has(normA) ? systemOrderMap.get(normA) : Number.MAX_SAFE_INTEGER
    const orderB = systemOrderMap.has(normB) ? systemOrderMap.get(normB) : Number.MAX_SAFE_INTEGER
    if (orderA !== orderB) return orderA - orderB
    if (normA !== normB) return normA.localeCompare(normB)
    return (a.name || '').localeCompare(b.name || '')
  })

  const grouped = []
  const groupMap = new Map()
  sortedMaterials.forEach(entry => {
    const key = (entry.system || 'Andet').toString()
    if (!groupMap.has(key)) {
      const group = { system: key, count: 0, rows: [] }
      groupMap.set(key, group)
      grouped.push(group)
    }
    const group = groupMap.get(key)
    group.count += 1
    group.rows.push(entry)
  })

  const systemSummary = grouped
    .map(group => `${group.system || 'Ukendt'} (${group.count})`)
    .join(', ')

  const workers = Array.isArray(wage.workers) ? wage.workers : []
  const wageRows = workers.map(worker => ({
    workerName: worker.name || worker.type || '',
    hours: toNumber(worker.hours),
    baseRate: toNumber(worker.rate || worker.hourlyWithAllowances),
    wageSum: toNumber(worker.total),
  }))

  const materialTotal = toNumber(totals.materials)
  const wageTotal = toNumber(wage?.totals?.sum)
  const hoursTotal = toNumber(wage?.totals?.hours)
  const akkordTotal = toNumber(totals.akkord)
  const projectTotal = toNumber(totals.project || akkordTotal + wageTotal)

  const kmQuantity = toNumber(extras?.km?.quantity)
  const kmAmount = toNumber(breakdown.km ?? extras?.km?.amount)
  const kmRate = kmQuantity ? kmAmount / kmQuantity : toNumber(extras?.km?.rate)
  const tralleAmount = toNumber(breakdown.tralle ?? extras?.tralle?.amount)
  const slaebAmount = toNumber(breakdown.slaeb ?? extras?.slaeb?.amount)
  const extraWorkEntries = Array.isArray(extras?.extraWork) ? extras.extraWork : []
  const extraWorkSum = extraWorkEntries.reduce((sum, entry) => sum + toNumber(entry.amount), 0)
  const timePrice = hoursTotal > 0 ? akkordTotal / hoursTotal : 0

  const summaryLines = [
    { label: 'Materialer', value: materialTotal },
    ...(extraWorkSum > 0 ? [{ label: 'Ekstra arbejde', value: extraWorkSum }] : []),
    ...(slaebAmount > 0 ? [{ label: 'Slæb', value: slaebAmount }] : []),
    { type: 'rule' },
    { label: 'Samlet akkordsum', value: akkordTotal, type: 'total' },
    { label: 'Timer', value: `${formatHours(hoursTotal)} timer` },
    { label: 'Timepris (uden tillæg)', value: formatKrPerHour(timePrice) },
    ...(kmAmount > 0 ? [{
      label: 'Kilometer',
      value: formatKr(kmAmount),
      auxText: `(${formatNumber(kmQuantity)} km @ ${formatKr(kmRate)})`,
    }] : []),
    ...(tralleAmount > 0 ? [{ label: 'Tralleløft', value: formatKr(tralleAmount) }] : []),
    { type: 'rule' },
    { label: 'Lønsum', value: wageTotal },
    { label: 'Projektsum', value: projectTotal, type: 'total' },
  ]

  return {
    meta: {
      generatedAt: meta.exportedAt || new Date().toISOString(),
      caseNo: meta.caseNumber || info.sagsnummer || 'UKENDT',
      title: meta.caseName || info.navn || '',
    },
    caseInfo: {
      caseNo: meta.caseNumber || info.sagsnummer || '-',
      title: meta.caseName || info.navn || '-',
      customer: meta.customer || info.kunde || '-',
      address: meta.address || info.adresse || '-',
      datetime: meta.date || info.dato || meta.createdAt || '',
      workers: wageRows.map(w => w.workerName).filter(Boolean),
      systemsSummaryText: systemSummary,
    },
    comment,
    materials: sortedMaterials,
    materialsGrouped: grouped,
    totals: { materialTotal, wageTotal, akkordTotal, projectTotal },
    wages: wageRows,
    summaryLines,
  }
}

export async function exportPDFBlob(data, options = {}) {
  const { allowPlaceholder = true } = options || {}
  const customSagsnummer = options.customSagsnummer
  const providedLibs = options.exportLibs

  const pdfModel = options?.pdfModel || buildPdfModel(options?.model || data)

  if (!pdfModel || typeof pdfModel !== 'object') {
    if (allowPlaceholder) {
      console.warn('[cssmateExportPDFBlob] Ingen exportmodel – bruger placeholder-akkordseddel.pdf')

      const res = await fetch('/placeholders/placeholder-akkordseddel.pdf')
      if (!res.ok) {
        throw new Error(`Kunne ikke hente placeholder-akkordseddel.pdf (status ${res.status})`)
      }

      const blob = await res.blob()
      const pdfBlob = blob.type === 'application/pdf'
        ? blob
        : new Blob([await blob.arrayBuffer()], { type: 'application/pdf' })

      const baseName = sanitizeFilename(customSagsnummer || 'placeholder-akkordseddel')
      return { blob: pdfBlob, baseName, fileName: `${baseName}.pdf` }
    }

    throw new Error('Mangler exportmodel til PDF')
  }

  try {
    const { jsPDF } = providedLibs || await ensureExportLibs()
    const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: [PAGE.w, PAGE.h] })

    const baseName = sanitizeFilename(customSagsnummer || pdfModel.meta.caseNo || 'akkordseddel')
    const headerFooter = createHeaderFooter(doc, pdfModel)
    const renderer = createRenderer(doc, pdfModel, headerFooter, { layoutLog: options.layoutLog })
    renderer.renderDocument()

    doc.setProperties({
      title: `${pdfModel.meta.caseNo || 'Akkordseddel'} - Akkordseddel`,
      subject: 'Akkordseddel eksport',
    })

    const output = doc.output('blob')
    const blob = output instanceof Promise ? await output : output
    return { blob, baseName, fileName: `${baseName}.pdf` }
  } catch (error) {
    console.error('PDF eksport er ikke tilgængelig.', error)
    throw error
  }
}

if (typeof window !== 'undefined') {
  window.cssmateExportPDFBlob = exportPDFBlob
}

function createHeaderFooter(doc, model) {
  const headerText = 'Akkordseddel'
  const caseText = `Sagsnr ${model.meta.caseNo || ''}`.trim()
  const footerLeft = `Genereret ${formatDateTime(model.meta.generatedAt)}`

  const headerBaseline = MARGIN + 12

  const drawHeader = (pageNumber) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(SECTION_FONT)
    doc.text(headerText, MARGIN, headerBaseline)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(BODY_FONT)
    doc.text(caseText, MARGIN + CONTENT_WIDTH, headerBaseline, { align: 'right' })
  }

  const drawFooter = (pageNumber, totalPages) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    const y = PAGE.h - MARGIN - 4
    doc.text(footerLeft, MARGIN, y)
    const pageLabel = `Side ${pageNumber}/${totalPages}`
    doc.text(pageLabel, MARGIN + CONTENT_WIDTH, y, { align: 'right' })
  }

  return { drawHeader, drawFooter }
}

function createRenderer(doc, model, headerFooter, options = {}) {
  const layoutLog = Array.isArray(options.layoutLog) ? options.layoutLog : null
  const cursor = createLayoutCursor(doc, { renderHeader: headerFooter.drawHeader })
  const LINE_HEIGHT_TABLE = 14

  const logOp = (op) => {
    if (layoutLog) layoutLog.push(op)
  }

  const setPage = (pageNo) => {
    doc.setPage(pageNo)
    headerFooter.drawHeader(pageNo)
  }

  headerFooter.drawHeader(cursor.page)

  const drawSectionHeader = (label) => {
    cursor.ensureSpace(H.section)
    const headerY = cursor.toPageY()
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(SECTION_FONT)
    doc.text(label, cursor.x, headerY)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(BODY_FONT)
    cursor.moveDown(H.section)
    return headerY
  }

  const drawTitle = () => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(TITLE_FONT)
    doc.text('Akkordseddel', cursor.x, cursor.toPageY())
    cursor.moveDown(28)
  }

  const drawCaseInfo = () => {
    drawSectionHeader('Sagsinfo')
    const lines = [
      { label: 'Sagsnummer', value: model.caseInfo.caseNo || '-' },
      { label: 'Navn/opgave', value: model.caseInfo.title || '-' },
      { label: 'Adresse', value: model.caseInfo.address || '-' },
      { label: 'Kunde', value: model.caseInfo.customer || '-' },
      { label: 'Dato', value: model.caseInfo.datetime || '-' },
      { label: 'Montørnavne', value: model.caseInfo.workers.join(', ') || '-' },
      { label: 'Systemer', value: model.caseInfo.systemsSummaryText || '-' },
    ]

    lines.forEach(entry => {
      cursor.ensureSpace(H.row)
      doc.setFont('helvetica', 'bold')
      doc.text(`${entry.label}:`, cursor.x, cursor.toPageY())
      doc.setFont('helvetica', 'normal')
      const valueLines = doc.splitTextToSize(String(entry.value || '-'), CONTENT_WIDTH - 160)
      valueLines.forEach((line, index) => {
        cursor.ensureSpace(H.row)
        doc.text(line, cursor.x + 140, cursor.toPageY())
        if (index < valueLines.length - 1) {
          cursor.moveDown(10)
        }
      })
      cursor.moveDown(H.row)
    })
    cursor.moveDown(H.gapSm)
  }

  const drawComment = () => {
    const text = (model.comment || '').toString().trim()
    if (!text) return
    drawSectionHeader('Kommentar')
    const lines = doc.splitTextToSize(text, CONTENT_WIDTH)
    lines.forEach(line => {
      cursor.ensureSpace(H.row)
      doc.text(line, cursor.x, cursor.toPageY())
      cursor.moveDown(H.row)
    })
    cursor.moveDown(H.gapSm)
  }

  const drawTableHeader = (columns) => {
    cursor.ensureSpace(H.tableHeader)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(BODY_FONT)
    let x = cursor.x
    columns.forEach(col => {
      const align = col.align === 'right' ? 'right' : col.align === 'center' ? 'center' : 'left'
      const textX = align === 'right'
        ? x + col.width
        : align === 'center'
          ? x + col.width / 2
          : x
      doc.text(col.label, textX, cursor.toPageY(), { align })
      x += col.width
    })
    doc.setFont('helvetica', 'normal')
    cursor.moveDown(H.tableHeader)
  }

  const measureWrap = (text, width) => {
    doc.setFontSize(BODY_FONT)
    const maxWidth = width - 6
    const lines = doc.splitTextToSize(String(text || ''), maxWidth)
    const limited = lines.slice(0, 2)
    return limited
  }

  const renderMaterialsContinuation = () => {
    drawSectionHeader('Materialer (fortsat)')
    drawTableHeader(materialColumns)
  }

  const drawMaterialRow = (row) => {
    const nameLines = measureWrap(row.name, COLS_MATERIAL.name)
    const rowHeight = nameLines.length > 1 ? H.rowWrap2 : H.row
    cursor.ensureSpace(rowHeight, { withTableHeader: renderMaterialsContinuation })

    logOp({ kind: 'row', pageIndex: cursor.page, y: cursor.y })

    let x = cursor.x
    const cells = [
      { width: COLS_MATERIAL.idx, value: row.idx, align: 'center' },
      { width: COLS_MATERIAL.sys, value: row.system || '-', align: 'left' },
      { width: COLS_MATERIAL.name, value: nameLines, align: 'left', multiline: true },
      { width: COLS_MATERIAL.qty, value: formatQty(row.qty), align: 'right' },
      { width: COLS_MATERIAL.price, value: formatKr(row.unitPrice), align: 'right' },
      { width: COLS_MATERIAL.sum, value: formatKr(row.lineTotal), align: 'right' },
    ]

    cells.forEach(cell => {
      const align = cell.align || 'left'
      if (cell.multiline) {
        cell.value.forEach((line, idx) => {
          const textY = cursor.toPageY(12 + idx * LINE_HEIGHT_TABLE)
          doc.text(line, x + 2, textY, { align })
        })
      } else {
        const textX = align === 'right' ? x + cell.width : align === 'center' ? x + cell.width / 2 : x + 2
        doc.text(String(cell.value ?? ''), textX, cursor.toPageY(12), { align })
      }
      x += cell.width
    })

    cursor.moveDown(rowHeight)
    return rowHeight
  }

  const drawSystemSeparator = (system, count) => {
    cursor.ensureSpace(H.groupRow + H.row, { withTableHeader: renderMaterialsContinuation })
    logOp({ kind: 'group', pageIndex: cursor.page, y: cursor.y })
    doc.setFont('helvetica', 'bold')
    doc.text(`${system || 'Andet'} (${count} linjer)`, cursor.x, cursor.toPageY(12))
    doc.setFont('helvetica', 'normal')
    cursor.moveDown(H.groupRow)
    return H.groupRow
  }

  const drawMaterialTable = () => {
    drawSectionHeader('Materialer')
    drawTableHeader(materialColumns)

    model.materialsGrouped.forEach(group => {
      const hasRows = Array.isArray(group.rows) && group.rows.length > 0
      if (!hasRows) return
      drawSystemSeparator(group.system, group.count)
      group.rows.forEach(drawMaterialRow)
    })

    cursor.ensureSpace(H.row, { withTableHeader: renderMaterialsContinuation })
    let x = cursor.x + COLS_MATERIAL.idx + COLS_MATERIAL.sys + COLS_MATERIAL.name + COLS_MATERIAL.qty + COLS_MATERIAL.price
    doc.setFont('helvetica', 'bold')
    doc.text('Materialesum', cursor.x + COLS_MATERIAL.idx + COLS_MATERIAL.sys + COLS_MATERIAL.name + COLS_MATERIAL.qty + COLS_MATERIAL.price - 2, cursor.toPageY(12), { align: 'right' })
    doc.text(formatKr(model.totals.materialTotal), x + COLS_MATERIAL.sum, cursor.toPageY(12), { align: 'right' })
    doc.setFont('helvetica', 'normal')
    cursor.moveDown(H.row)
  }

  const renderWageContinuation = () => {
    drawSectionHeader('Løn (fortsat)')
    drawTableHeader(wageColumns)
  }

  const drawWageTable = () => {
    cursor.ensureSpace(H.section + H.tableHeader)
    drawSectionHeader('Løn')
    drawTableHeader(wageColumns)

    if (!model.wages.length) {
      cursor.ensureSpace(H.row)
      doc.text('Ingen registrerede montører', cursor.x, cursor.toPageY(12))
      cursor.moveDown(H.row)
      return
    }

    model.wages.forEach(worker => {
      cursor.ensureSpace(H.row, { withTableHeader: renderWageContinuation })
      logOp({ kind: 'wageRow', pageIndex: cursor.page, y: cursor.y })
      let x = cursor.x
      const cells = [
        { width: COLS_WAGE.who, value: worker.workerName || '-', align: 'left' },
        { width: COLS_WAGE.hrs, value: formatHours(worker.hours), align: 'right' },
        { width: COLS_WAGE.rate, value: formatKr(worker.baseRate), align: 'right' },
        { width: COLS_WAGE.sum, value: formatKr(worker.wageSum), align: 'right' },
      ]

      cells.forEach(cell => {
        const align = cell.align || 'left'
        const textX = align === 'right' ? x + cell.width : align === 'center' ? x + cell.width / 2 : x + 2
        doc.text(String(cell.value ?? ''), textX, cursor.toPageY(12), { align })
        x += cell.width
      })

      cursor.moveDown(H.row)
    })
  }

  const drawSummary = () => {
    const summaryReservedHeight = H.section + model.summaryLines.reduce((sum, entry) => {
      if (entry.type === 'rule') return sum + H.summaryRule
      return sum + H.summaryLine + (entry.auxText ? H.summaryAux : 0)
    }, 0)

    cursor.ensureSpace(summaryReservedHeight)
    logOp({ kind: 'summaryHeader', pageIndex: cursor.page, y: cursor.y })

    const headerBaseline = drawSectionHeader('Oversigt:')
    doc.setFont('helvetica', 'bold')
    doc.text('Løn & projektsum', cursor.x + COLS_SUMMARY.label + COLS_SUMMARY.value, headerBaseline, { align: 'right' })
    doc.setFont('helvetica', 'normal')

    model.summaryLines.forEach(entry => {
      if (entry.type === 'rule') {
        cursor.ensureSpace(H.summaryRule)
        doc.line(cursor.x, cursor.toPageY(4), cursor.x + CONTENT_WIDTH, cursor.toPageY(4))
        cursor.moveDown(H.summaryRule)
        return
      }

      const lineHeight = H.summaryLine + (entry.auxText ? H.summaryAux : 0)
      cursor.ensureSpace(lineHeight)
      const labelX = cursor.x
      const valueX = cursor.x + COLS_SUMMARY.label + COLS_SUMMARY.value
      const valueText = typeof entry.value === 'number' ? formatKr(entry.value) : String(entry.value || '')
      doc.setFont('helvetica', entry.type === 'total' ? 'bold' : 'normal')
      doc.text(entry.label, labelX, cursor.toPageY(12))
      doc.text(valueText, valueX, cursor.toPageY(12), { align: 'right' })
      if (entry.auxText) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        doc.text(entry.auxText, labelX, cursor.toPageY(22))
        doc.setFontSize(BODY_FONT)
        cursor.moveDown(H.summaryAux)
      }
      cursor.moveDown(H.summaryLine)
    })
  }

  const materialColumns = [
    { key: 'idx', label: '#', width: COLS_MATERIAL.idx, align: 'center' },
    { key: 'system', label: 'System', width: COLS_MATERIAL.sys, align: 'left' },
    { key: 'name', label: 'Materiale', width: COLS_MATERIAL.name, align: 'left' },
    { key: 'qty', label: 'Antal', width: COLS_MATERIAL.qty, align: 'right' },
    { key: 'price', label: 'Pris', width: COLS_MATERIAL.price, align: 'right' },
    { key: 'total', label: 'Linjesum', width: COLS_MATERIAL.sum, align: 'right' },
  ]

  const wageColumns = [
    { key: 'workerName', label: 'Medarbejder', width: COLS_WAGE.who, align: 'left' },
    { key: 'hours', label: 'Timer', width: COLS_WAGE.hrs, align: 'right' },
    { key: 'rate', label: 'Sats', width: COLS_WAGE.rate, align: 'right' },
    { key: 'sum', label: 'Lønsum', width: COLS_WAGE.sum, align: 'right' },
  ]

  const addFooters = () => {
    const totalPages = doc.internal.getNumberOfPages()
    for (let i = 1; i <= totalPages; i += 1) {
      setPage(i)
      headerFooter.drawFooter(i, totalPages)
    }
  }

  const renderDocument = () => {
    drawTitle()
    drawCaseInfo()
    drawComment()
    drawMaterialTable()
    drawWageTable()
    cursor.ensureSpace(H.gapMd)
    cursor.moveDown(H.gapMd)
    drawSummary()
    addFooters()
  }

  return {
    renderDocument,
  }
}
