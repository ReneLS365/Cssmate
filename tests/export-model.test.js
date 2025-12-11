import assert from 'node:assert/strict'
import test from 'node:test'

import { buildExportModel, formatCsvNumber } from '../js/export-model.js'
import { buildAkkordCSV } from '../js/akkord-csv.js'

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
