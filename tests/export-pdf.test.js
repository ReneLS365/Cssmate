import assert from 'node:assert/strict'
import test from 'node:test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { buildExportModel } from '../js/export-model.js'

async function getExportPDFBlob () {
  if (typeof globalThis.self === 'undefined') {
    globalThis.self = globalThis
  }
  if (typeof globalThis.window === 'undefined') {
    globalThis.window = { document: { createElement: () => ({ getContext: () => ({}) }) }, navigator: {}, __CSSMATE_DISABLE_HTML2CANVAS: true }
  }
  globalThis.window.__CSSMATE_DISABLE_HTML2CANVAS = true
  if (typeof globalThis.navigator === 'undefined') {
    globalThis.navigator = globalThis.window.navigator
  }
  if (typeof globalThis.document === 'undefined') {
    globalThis.document = globalThis.window.document
  }

  const mod = await import('../js/export-pdf.js')
  return mod.exportPDFBlob
}

function createPdfLibJsPDF () {
  async function buildPdfFromOps (ops, props) {
    const pdfDoc = await PDFDocument.create()
    if (props?.title) pdfDoc.setTitle(props.title)
    if (props?.subject) pdfDoc.setSubject(props.subject)
    let page = pdfDoc.addPage([595.28, 841.89])
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)

    ops.forEach(op => {
      if (op.type === 'pageBreak') {
        page = pdfDoc.addPage([595.28, 841.89])
        return
      }
      if (op.type === 'text') {
        const y = page.getHeight() - op.y
        page.drawText(op.str, { x: op.x, y, size: op.fontSize || 10, font })
        return
      }
      if (op.type === 'rect') {
        const y = page.getHeight() - op.y - op.h
        page.drawRectangle({ x: op.x, y, width: op.w, height: op.h, borderWidth: 0.25 })
      }
    })

    const bytes = await pdfDoc.save({ useObjectStreams: false, compress: false })
    return new Blob([bytes], { type: 'application/pdf' })
  }

  return class JsPDFStub {
    constructor () {
      this.ops = []
      JsPDFStub.lastOps = this.ops
      this.fontSize = 10
      this.internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } }
    }

    setFontSize (size) { this.fontSize = size }
    setFont () {}
    text (str, x, y) { this.ops.push({ type: 'text', str, x, y, fontSize: this.fontSize }) }
    rect (x, y, w, h) { this.ops.push({ type: 'rect', x, y, w, h }) }
    addPage () { this.ops.push({ type: 'pageBreak' }) }
    splitTextToSize (text) { return Array.isArray(text) ? text : String(text).split('\n') }
    setProperties (props) { this.props = props }
    output () { return buildPdfFromOps(this.ops, this.props) }
  }
}

test('exportPDFBlob renders full akkordseddel content', async () => {
  const payload = {
    info: {
      sagsnummer: 'CASE-FULL-1',
      navn: 'Testopgave',
      adresse: 'Eksempelvej 2',
      kunde: 'Test Kunde',
      dato: '2024-10-01',
    },
    meta: { system: 'bosta' },
    items: [
      { lineNumber: 1, itemNumber: 'MAT-10', name: 'Rør 2m', quantity: 10, unitPrice: 12, lineTotal: 120 },
      { lineNumber: 2, itemNumber: 'MAT-11', name: 'Dæk', quantity: 5, unitPrice: 20, lineTotal: 100 },
    ],
    extras: {
      km: { quantity: 50, rate: 7, amount: 350 },
      slaeb: { percent: 5, amount: 11 },
      tralle: { lifts35: 2, lifts50: 1, amount: 120 },
      extraWork: [{ type: 'Ekstraarbejde', quantity: 2, rate: 100, amount: 200 }],
    },
    extraInputs: { km: 50, slaebePctInput: 5 },
    wage: {
      workers: [
        { name: 'Montør A', type: 'Montage', hours: 12, rate: 200, total: 2400 },
        { name: 'Montør B', type: 'Demontage', hours: 8, rate: 180, total: 1440 },
      ],
      totals: { hours: 20, sum: 3840 },
    },
    totals: {
      materials: 220,
      extras: 681,
      extrasBreakdown: { km: 350, slaeb: 11, tralle: 120, extraWork: 200 },
      akkord: 901,
      project: 901,
    },
  }

  const JsPDFStub = createPdfLibJsPDF()
  const exportPDFBlob = await getExportPDFBlob()
  const model = buildExportModel(payload)
  const { blob, fileName } = await exportPDFBlob(payload, { skipValidation: true, skipBeregn: true, exportLibs: { jsPDF: JsPDFStub }, model })
  const buffer = Buffer.from(await blob.arrayBuffer())
  const parsed = await PDFDocument.load(buffer)
  const textContent = buffer.toString('latin1')
  const renderedText = (JsPDFStub.lastOps || [])
    .filter(op => op.type === 'text')
    .map(op => op.str)
    .join(' ')

  assert.match(fileName, /CASE-FULL-1/)
  assert.match(parsed.getTitle() || '', /CASE-FULL-1/)

  ;[
    'Akkordseddel',
    'Sagsnummer',
    'Materialer',
    'Løn',
    'Arbejder',
    'Oversigt',
    'CASE-FULL-1',
    'Test Kunde',
    'Rør 2m',
    'Montage',
    'Demontage',
    'Kilometer',
    'Projektsum',
  ].forEach(label => {
    assert.ok(renderedText.includes(label) || textContent.includes(label), `PDF indeholder ${label}`)
  })
})
