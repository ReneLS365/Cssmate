import assert from 'node:assert/strict'
import test from 'node:test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { exportAkkordJsonAndPdf, setExportDependencies } from '../js/akkord-export-ui.js'

function setupDownloadSpies () {
  const downloads = []
  const anchors = []

  const originalURL = globalThis.URL
  const originalDocument = globalThis.document
  const originalWindow = globalThis.window
  const originalCustomEvent = globalThis.CustomEvent

  globalThis.URL = {
    createObjectURL: (blob) => {
      downloads.push(blob)
      return 'blob:mock-url'
    },
    revokeObjectURL: () => {},
  }

  globalThis.document = {
    querySelector: () => null,
    getElementsByTagName: () => [],
    createElement: () => {
      const anchor = {
        href: '',
        download: '',
        click() { anchors.push({ href: this.href, download: this.download }) },
        remove() {},
      }
      return anchor
    },
    body: {
      appendChild() {},
      removeChild() {},
    },
    defaultView: {},
  }

  globalThis.window = {
    cssmateUpdateActionHint() {},
    dispatchEvent() {},
  }

  globalThis.CustomEvent = class {
    constructor (type, options = {}) {
      this.type = type
      this.detail = options.detail
    }
  }

  const restore = () => {
    globalThis.URL = originalURL
    globalThis.document = originalDocument
    globalThis.window = originalWindow
    globalThis.CustomEvent = originalCustomEvent
  }

  return { downloads, anchors, restore }
}

function createTestData () {
  return {
    info: {
      sagsnummer: 'SA-EXPORT-1',
      kunde: 'Test Kunde',
      adresse: 'Eksempelvej 1',
      navn: 'Testsag',
      dato: '2024-05-10',
      montoer: 'Montør M',
    },
    meta: {},
    linjer: [
      {
        linjeNr: 1,
        system: 'bosta',
        kategori: 'test',
        varenr: 'MAT-001',
        navn: 'Testmateriale',
        enhed: 'stk',
        antal: 2,
        stkPris: 125,
        linjeBelob: 250,
      },
    ],
    extras: {
      kmBelob: 100,
    },
    extraInputs: {
      km: 10,
      slaebePctInput: 5,
    },
    tralleState: {
      n35: 1,
      n50: 0,
      sum: 10.44,
    },
    totals: {
      projektsum: 360,
      totalAkkord: 360,
      totalMaterialer: 250,
      slaebBelob: 18.22,
    },
    jobType: 'montage',
    jobFactor: 1,
    comment: 'Denne kommentar skal følge med i eksporten',
  }
}

async function createMinimalPdf (text) {
  const pdfDoc = await PDFDocument.create()
  pdfDoc.setTitle(String(text))
  pdfDoc.setSubject(String(text))
  const page = pdfDoc.addPage()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const { height } = page.getSize()
  page.drawText(String(text), { x: 48, y: height - 72, size: 12, font })
  const bytes = await pdfDoc.save({ useObjectStreams: false, compress: false })
  return Buffer.from(bytes)
}

test('generates and validates JSON and PDF exports', async t => {
  const data = createTestData()
  const pdfBuffer = await createMinimalPdf(`Sagsnummer: ${data.info.sagsnummer} - Kunde: ${data.info.kunde} - Sum: ${data.totals.projektsum}`)

  const { downloads, anchors, restore } = setupDownloadSpies()

  setExportDependencies({
    buildAkkordData: () => data,
    exportPDFBlob: async () => ({
      blob: pdfBuffer,
      fileName: `${data.info.sagsnummer}.pdf`,
    }),
  })

  t.after(() => {
    setExportDependencies({})
    restore()
  })

  const result = await exportAkkordJsonAndPdf()

  assert.ok(result?.jsonFileName?.endsWith('.json'), 'JSON file name is returned')
  assert.ok(result?.pdfFileName?.endsWith('.pdf'), 'PDF file name is returned')

  const jsonIndex = anchors.findIndex(entry => entry.download.endsWith('.json'))
  const pdfIndex = anchors.findIndex(entry => entry.download.endsWith('.pdf'))

  assert.ok(jsonIndex >= 0, 'JSON download is triggered')
  assert.ok(pdfIndex >= 0, 'PDF download is triggered')
  assert.equal(anchors.some(entry => entry.download.endsWith('.zip')), false, 'ZIP download is not triggered')

  const jsonBlob = downloads[jsonIndex]
  const pdfBlob = downloads[pdfIndex]

  const jsonBuffer = typeof jsonBlob.arrayBuffer === 'function'
    ? await jsonBlob.arrayBuffer()
    : jsonBlob
  const jsonText = Buffer.from(jsonBuffer).toString('utf8')
  const parsedJson = JSON.parse(jsonText)
  assert.equal(parsedJson.meta.caseNumber, data.info.sagsnummer)
  assert.equal(parsedJson.meta.customer, data.info.kunde)
  assert.equal(parsedJson.meta.comment, data.comment)
  assert.equal(parsedJson.info.comment, data.comment)
  assert.ok(Array.isArray(parsedJson.items))
  assert.equal(parsedJson.totals.materials, data.totals.totalMaterialer)

  const pdfBinary = typeof pdfBlob.arrayBuffer === 'function'
    ? await pdfBlob.arrayBuffer()
    : pdfBlob
  const parsedPdfDoc = await PDFDocument.load(Buffer.from(pdfBinary))
  const parsedTitle = parsedPdfDoc.getTitle() || ''
  assert.match(parsedTitle, /SA-EXPORT-1/, 'PDF includes sagsnummer')
  assert.match(parsedTitle, /Test Kunde/, 'PDF includes customer')
})
