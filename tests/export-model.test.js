import assert from 'node:assert/strict'
import test from 'node:test'
import JSZip from 'jszip'
import { PDFDocument, StandardFonts } from 'pdf-lib'

import { buildExportModel, formatCsvNumber } from '../js/export-model.js'
import { buildAkkordCSV } from '../js/akkord-csv.js'
import { exportZipFromAkkord, setZipExportDependencies } from '../js/export-zip.js'

function createSampleCase () {
  return {
    meta: {
      sagsnummer: 'TC-100',
      kunde: 'Total Kunde',
      adresse: 'Testvej 1',
      navn: 'Totalsag',
      dato: '2024-06-30',
    },
    linjer: [
      { linjeNr: 1, system: 'bosta', kategori: 'A', varenr: 'MAT-01', navn: 'Rør', enhed: 'stk', antal: 4, stkPris: 25, linjeBelob: 100 },
      { linjeNr: 2, system: 'bosta', kategori: 'B', varenr: 'MAT-02', navn: 'Kobling', enhed: 'stk', antal: 2, stkPris: 15, linjeBelob: 30 },
    ],
    extraInputs: {
      km: 5,
      slaebePctInput: 10,
    },
    extras: {
      kmBelob: 50,
      slaebBelob: 13,
    },
    akkord: {
      ekstraarbejde: [
        { type: 'Boring af huller', antal: 2, enhed: 'stk', sats: 4, belob: 8 },
      ],
      totalMaterialer: 130,
      totalAkkord: 201,
    },
    totals: {
      totalMaterialer: 130,
      totalAkkord: 201,
      ekstraarbejde: 71,
    },
  }
}

async function createPdfBuffer (text) {
  const pdfDoc = await PDFDocument.create()
  const page = pdfDoc.addPage()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const { height } = page.getSize()
  page.drawText(String(text), { x: 48, y: height - 72, size: 12, font })
  const bytes = await pdfDoc.save({ useObjectStreams: false, compress: false })
  return Buffer.from(bytes)
}

test('buildExportModel normalizes totals and extras', () => {
  const model = buildExportModel(createSampleCase())
  assert.equal(model.meta.caseNumber, 'TC-100')
  assert.equal(model.meta.version, '2.0')
  assert.equal(model.info.sagsnummer, 'TC-100')
  assert.equal(model.totals.materials, 130)
  assert.equal(model.totals.akkord, 201)
  assert.equal(model.extras.km.amount, 50)
  assert.equal(model.extras.slaeb.amount, 13)
  assert.equal(model.extras.extraWork[0].amount, 8)
  assert.equal(model.extras.fields.kmBelob, 50)
  assert.equal(model.extraInputs.slaebePctInput, 10)
  assert.equal(model.totals.extrasBreakdown.extraWork, 8)
})

test('buildExportModel duplicates items into materials for compatibility', () => {
  const model = buildExportModel(createSampleCase())
  assert.equal(model.materials.length, model.items.length)

  model.materials.forEach((material, index) => {
    const item = model.items[index]
    assert.equal(material.id, item.itemNumber || item.id)
    assert.equal(material.name, item.name)
    assert.equal(material.qty, item.quantity)
    assert.equal(material.unitPrice, item.unitPrice)
    assert.equal(material.system, item.system)
    assert.equal(material.qty * material.unitPrice, item.quantity * item.unitPrice)
  })
})

test('buildAkkordCSV exports BOM, semicolons, and formatted numbers', () => {
  const csv = buildAkkordCSV(createSampleCase())
  assert.ok(csv.startsWith('\ufeff'), 'CSV starts with BOM')
  const lines = csv.split('\n').filter(Boolean)
  const materialLine = lines.find(line => line.startsWith('MATERIAL;'))
  assert.ok(materialLine?.includes('MAT-01'))
  assert.ok(materialLine?.includes(formatCsvNumber(25)))
  assert.ok(lines.some(line => line.includes('totalAkkord') || line.startsWith('#META;totalAkkord'))) // meta totals present
})

test('exportZipFromAkkord packs JSON, PDF and CSV from same model', async t => {
  const data = createSampleCase()
  const pdfBuffer = await createPdfBuffer('Totalsag')

  setZipExportDependencies({
    ensureZipLib: async () => ({ JSZip }),
    exportPDFBlob: async () => ({ blob: pdfBuffer, fileName: 'Totalsag.pdf' }),
  })

  const downloads = []
  const anchors = []
  const originalURL = globalThis.URL
  const originalDocument = globalThis.document
  const originalWindow = globalThis.window

  globalThis.URL = {
    createObjectURL: (blob) => { downloads.push(blob); return 'blob:mock-url' },
    revokeObjectURL: () => {},
  }
  globalThis.document = {
    createElement: () => {
      const anchor = { download: '', href: '', click () { anchors.push(this) }, remove () {} }
      return anchor
    },
    body: { appendChild () {}, removeChild () {} },
  }
  globalThis.window = { cssmateUpdateActionHint () {}, dispatchEvent () {} }

  t.after(() => {
    setZipExportDependencies({})
    globalThis.URL = originalURL
    globalThis.document = originalDocument
    globalThis.window = originalWindow
  })

  const zipResult = await exportZipFromAkkord(data, { baseName: 'Totalsag' })
  assert.ok(zipResult.files.length >= 3)
  assert.ok(anchors.some(a => a.download.endsWith('.zip')))

  const [zipBlob] = downloads
  const zipBuffer = Buffer.from(await zipBlob.arrayBuffer())
  const zip = await JSZip.loadAsync(zipBuffer)
  assert.ok(zip.filter(path => path.endsWith('.json')).length === 1)
  assert.ok(zip.filter(path => path.endsWith('.csv')).length === 1)
  assert.ok(zip.filter(path => path.endsWith('.pdf')).length === 1)
})
