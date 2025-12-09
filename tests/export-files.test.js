import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { exec as execCallback } from 'node:child_process'
import JSZip from 'jszip'
import test, { before } from 'node:test'
import { PDFDocument, StandardFonts } from 'pdf-lib'

const exec = promisify(execCallback)

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
    meta: {
      excelSystems: [],
    },
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

before(async () => {
  await exec('npm run build')
})

test('generates and validates JSON, PDF, and ZIP exports', async t => {
  const { buildAkkordJsonPayload } = await import('../js/export-json.js')
  const data = createTestData()
  const tmpDir = await mkdtemp(join(tmpdir(), 'cssmate-export-'))

  const jsonPayload = buildAkkordJsonPayload(data, data.info.sagsnummer, { skipValidation: true, skipBeregn: true })
  assert.ok(jsonPayload?.content, 'JSON payload exists')
  await writeFile(join(tmpDir, jsonPayload.fileName), jsonPayload.content, 'utf8')

  const parsedJson = JSON.parse(jsonPayload.content)
  assert.equal(parsedJson.meta.caseNumber, data.info.sagsnummer)
  assert.equal(parsedJson.meta.customer, data.info.kunde)
  assert.ok(Array.isArray(parsedJson.items))
  assert.equal(parsedJson.totals.materials, data.totals.totalMaterialer)

  const pdfBuffer = await createMinimalPdf(`Sagsnummer: ${data.info.sagsnummer} - Kunde: ${data.info.kunde} - Sum: ${data.totals.projektsum}`)

  const { exportZipFromAkkord, setZipExportDependencies } = await import('../js/export-zip.js')
  setZipExportDependencies({
    ensureZipLib: async () => ({ JSZip }),
    exportPDFBlob: async () => ({
      blob: pdfBuffer,
      fileName: `${jsonPayload.baseName}.pdf`,
    }),
  })

  const { downloads, anchors, restore } = setupDownloadSpies()

  t.after(() => {
    setZipExportDependencies({})
    restore()
  })

  const zipResult = await exportZipFromAkkord(data, { baseName: jsonPayload.baseName })
  assert.ok(zipResult?.files?.length > 0, 'ZIP export reports files')
  assert.ok(anchors.some(entry => entry.download.endsWith('.zip')), 'ZIP download is triggered')

  const [zipBlob] = downloads.slice(-1)
  const zipBuffer = Buffer.from(await zipBlob.arrayBuffer())
  const zip = await JSZip.loadAsync(zipBuffer)

  const zipJsonFiles = zip.filter((path) => path.endsWith('.json'))
  assert.ok(zipJsonFiles.length === 1, 'ZIP contains JSON file')
  const zippedJsonContent = await zipJsonFiles[0].async('string')
  const zippedJson = JSON.parse(zippedJsonContent)
  const standaloneJson = JSON.parse(jsonPayload.content)
  assert.equal(zippedJson.meta.caseNumber, standaloneJson.meta.caseNumber)
  assert.equal(zippedJson.totals.akkord, standaloneJson.totals.akkord)
  assert.equal(zippedJson.totals.materials, standaloneJson.totals.materials)
  assert.equal(zippedJson.extras.km.amount, standaloneJson.extras.km.amount)

  const zipCsvFiles = zip.filter((path) => path.endsWith('.csv'))
  assert.ok(zipCsvFiles.length === 1, 'ZIP contains CSV file')
  const csvContent = await zipCsvFiles[0].async('string')
  assert.ok(csvContent.startsWith('\ufeff'), 'CSV is UTF-8 with BOM')
  assert.ok(csvContent.includes('MATERIAL;SA-EXPORT-1'), 'CSV contains case number on material lines')
  assert.ok(/;250,00/.test(csvContent) || /;250.00/.test(csvContent), 'CSV contains material sum formatted')

  const zipPdfFiles = zip.filter((path) => path.endsWith('.pdf'))
  assert.ok(zipPdfFiles.length === 1, 'ZIP contains PDF file')
  const zippedPdfBuffer = await zipPdfFiles[0].async('nodebuffer')
  const parsedPdfDoc = await PDFDocument.load(zippedPdfBuffer)
  const parsedTitle = parsedPdfDoc.getTitle() || ''
  assert.match(parsedTitle, /SA-EXPORT-1/, 'PDF includes sagsnummer')
  assert.match(parsedTitle, /Test Kunde/, 'PDF includes customer')
  assert.match(parsedTitle, /360/, 'PDF includes sum')
})

test('repeated ZIP exports do not trigger MaxListeners warnings', async () => {
  const { exportZipFromAkkord, setZipExportDependencies } = await import('../js/export-zip.js')
  const data = createTestData()
  const warningMessages = []
  const onWarning = (warning) => {
    if (warning?.name === 'MaxListenersExceededWarning' || /MaxListenersExceededWarning/.test(String(warning?.message))) {
      warningMessages.push(warning.message || warning.toString())
    }
  }

  const { downloads, restore } = setupDownloadSpies()

  setZipExportDependencies({
    ensureZipLib: async () => ({ JSZip }),
    exportPDFBlob: async () => ({
      blob: Buffer.from('pdf'),
      fileName: 'case.pdf',
    }),
  })

  process.on('warning', onWarning)

  try {
    for (let i = 0; i < 20; i += 1) {
      await exportZipFromAkkord(data, { baseName: `CASE-${i}` })
    }
  } finally {
    process.removeListener('warning', onWarning)
    setZipExportDependencies({})
    restore()
  }

  assert.equal(downloads.length, 20, 'each export triggers a download')
  assert.equal(warningMessages.length, 0, warningMessages.join('\n'))
})
