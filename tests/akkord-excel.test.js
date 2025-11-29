import assert from 'node:assert/strict'
import test from 'node:test'

import { buildExportModel } from '../js/export-model.js'
import { createWorkbookFromModel } from '../src/export/akkord-excel.js'

function createMockXlsx () {
  const encodeAddress = (row, col) => {
    const letters = []
    let n = col + 1
    while (n > 0) {
      const rem = (n - 1) % 26
      letters.unshift(String.fromCharCode(65 + rem))
      n = Math.floor((n - 1) / 26)
    }
    return `${letters.join('')}${row + 1}`
  }

  const utils = {
    book_new () {
      return { SheetNames: [], Sheets: {} }
    },
    book_append_sheet (workbook, sheet, name) {
      workbook.SheetNames.push(name)
      workbook.Sheets[name] = sheet
    },
    aoa_to_sheet (rows) {
      const sheet = {}
      rows.forEach((row, rIndex) => {
        row.forEach((value, cIndex) => {
          const cellRef = encodeAddress(rIndex, cIndex)
          sheet[cellRef] = { t: typeof value === 'number' ? 'n' : 's', v: value }
        })
      })
      sheet['!ref'] = `A1:${encodeAddress(rows.length - 1, (rows[0] || []).length - 1)}`
      return sheet
    },
  }

  return {
    utils,
    write (workbook) {
      return new TextEncoder().encode(JSON.stringify(workbook))
    },
    read (buffer) {
      return JSON.parse(new TextDecoder().decode(buffer))
    },
  }
}

function createSampleModel () {
  const data = {
    meta: {
      sagsnummer: '88888123',
      dato: '2025-11-29',
      kunde: 'Testkunde',
      adresse: 'Testvej 1',
      navn: 'Årgang 2025',
      system: 'bosta',
    },
    linjer: [
      { linjeNr: 1, system: 'bosta', varenr: 'MAT-01', navn: 'Rør', enhed: 'stk', antal: 10, stkPris: 12.5, linjeBelob: 125 },
      { linjeNr: 2, system: 'bosta', varenr: 'MAT-02', navn: 'Dæk', enhed: 'stk', antal: 5, stkPris: 30, linjeBelob: 150 },
    ],
    totals: {
      totalMaterialer: 275,
      totalAkkord: 275,
    },
  }
  return buildExportModel(data)
}

test('Excel workbook only contains current sheet and preserves meta as text', () => {
  const mockXlsx = createMockXlsx()
  const model = createSampleModel()
  const workbook = createWorkbookFromModel(model, 'bosta', mockXlsx)

  assert.deepEqual(workbook.SheetNames, ['Akkordseddel'])
  const sheet = workbook.Sheets['Akkordseddel']

  assert.equal(sheet.B3.t, 's')
  assert.equal(sheet.B3.v, '88888123')
  assert.equal(sheet.B7.t, 's')
  assert.equal(sheet.B7.v, '2025-11-29')
})

test('Excel buffer roundtrip keeps sheet names clean', () => {
  const mockXlsx = createMockXlsx()
  const model = createSampleModel()
  const workbook = createWorkbookFromModel(model, 'bosta', mockXlsx)
  const buffer = mockXlsx.write(workbook)
  const parsed = mockXlsx.read(buffer)

  assert.deepEqual(parsed.SheetNames, ['Akkordseddel'])
  const parsedSheet = parsed.Sheets['Akkordseddel']
  assert.equal(parsedSheet.B3.v, '88888123')
  assert.equal(parsedSheet.B7.v, '2025-11-29')
})
