import assert from 'node:assert/strict'
import test from 'node:test'
import { exportPDFBlob } from '../js/export-pdf.js'
import { buildExportModel } from '../js/export-model.js'
import { H } from '../js/pdf/layout-cursor.js'

function createLayoutHeavyData() {
  return {
    info: {
      sagsnummer: 'LAY-001',
      navn: 'Layout overlap check',
      kunde: 'Testkunde',
      adresse: 'Testvej 1',
      dato: '2024-05-21',
    },
    linjer: [
      { linjeNr: 1, system: 'bosta', navn: 'Spindelfod kort', antal: 20, stkPris: 3, linjeBelob: 60 },
      { linjeNr: 2, system: 'bosta', navn: 'Ramme 2,0m med meget langt navn der skal gå på to linjer for at tjekke wrap', antal: 4, stkPris: 125, linjeBelob: 500 },
      { linjeNr: 3, system: 'haki', navn: 'Haki dæk 3,05 m', antal: 10, stkPris: 150, linjeBelob: 1500 },
      { linjeNr: 4, system: 'haki', navn: 'Haki dæk 2,57 m', antal: 6, stkPris: 140, linjeBelob: 840 },
      { linjeNr: 5, system: 'haki', navn: 'Haki rækværk med ekstra langt navn til wrap test', antal: 3, stkPris: 90, linjeBelob: 270 },
    ],
    wage: {
      workers: [
        { name: 'Medarbejder 1', hours: 6, rate: 275, total: 1650 },
        { name: 'Medarbejder 2', hours: 5.5, rate: 260, total: 1430 },
        { name: 'Medarbejder 3', hours: 4, rate: 255, total: 1020 },
      ],
      totals: { hours: 15.5, sum: 4100 },
    },
    totals: {
      materials: 3170,
      akkord: 3170,
      project: 7270,
    },
  }
}

test('pdf-layout-no-overlap', async () => {
  const layoutLog = []
  const model = buildExportModel(createLayoutHeavyData())

  const { blob } = await exportPDFBlob(model, { model, layoutLog, skipValidation: true, skipBeregn: true })
  assert.ok(blob, 'PDF blob blev genereret')
  assert.ok(layoutLog.length > 0, 'Layout-log blev udfyldt')

  const logsByPage = new Map()
  layoutLog.forEach((entry) => {
    if (!logsByPage.has(entry.pageIndex)) logsByPage.set(entry.pageIndex, [])
    logsByPage.get(entry.pageIndex).push(entry)
  })

  logsByPage.forEach(entries => {
    for (let i = 1; i < entries.length; i += 1) {
      assert.ok(entries[i].y < entries[i - 1].y - 1, 'Y-positions skal falde ned gennem siden')
    }
  })

  for (let i = 1; i < layoutLog.length; i += 1) {
    const prev = layoutLog[i - 1]
    const current = layoutLog[i]
    if (current.kind === 'group' && prev.pageIndex === current.pageIndex && prev.kind === 'row') {
      assert.ok(current.y <= prev.y - H.row, 'Group row skal ligge under forrige materialerække')
    }
  }

  const summaryHeader = layoutLog.find((entry) => entry.kind === 'summaryHeader')
  const lastWageRow = [...layoutLog].reverse().find((entry) => entry.kind === 'wageRow')
  if (summaryHeader && lastWageRow && summaryHeader.pageIndex === lastWageRow.pageIndex) {
    assert.ok(summaryHeader.y <= lastWageRow.y - (H.gapMd - 1), 'Oversigt skal være adskilt fra løn-tabel med luft')
  }
})

