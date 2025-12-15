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

  globalThis.URL = originalURL
  if (globalThis.URL) {
    globalThis.URL.createObjectURL = (blob) => {
      downloads.push(blob)
      return 'blob:mock-url'
    }
    globalThis.URL.revokeObjectURL = () => {}
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

  const { downloads, anchors, restore } = setupDownloadSpies()
  const publishSharedCaseMock = () => Promise.resolve()

  setExportDependencies({
    buildAkkordData: () => data,
    publishSharedCase: publishSharedCaseMock,
  })

  t.after(() => {
    setExportDependencies({})
    restore()
  })

  const result = await exportAkkordJsonAndPdf()

  assert.ok(result?.jsonFileName?.endsWith('.json'), 'JSON file name is returned')
  assert.equal(anchors.length, 0, 'Ingen filer downloades under publicering')
  assert.equal(downloads.length, 0, 'Ingen blobs downloades under publicering')
})
