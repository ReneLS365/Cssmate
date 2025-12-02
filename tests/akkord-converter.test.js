import assert from 'node:assert/strict'
import test from 'node:test'

import { convertMontageToDemontage } from '../js/akkord-converter.js'

function sumMaterials(list = []) {
  return list.reduce((sum, item) => sum + Number(item.quantity ?? item.qty ?? 0) * Number(item.unitPrice ?? item.price ?? 0), 0)
}

test('convertMontageToDemontage maps export model to demontage payload', () => {
  const exportModel = {
    meta: {
      caseNumber: 'CASE-42',
      caseName: 'Facade',
      customer: 'Kunde A/S',
      system: 'haki',
      jobType: 'montage',
    },
    items: [
      { itemNumber: 'MAT-100', name: 'Rør', quantity: 3, unitPrice: 12.5, system: 'bosta' },
      { id: 'MAT-200', label: 'Dæk', qty: 2, price: 8 },
    ],
    extras: { km: { quantity: 1 } },
    wage: { workers: [{ name: 'Test', hours: 1, rate: 100 }] },
    totals: { materials: 0 },
  }

  const result = convertMontageToDemontage(exportModel)

  assert.equal(result.version, 1)
  assert.equal(result.jobType, 'demontage')
  assert.equal(result.meta.jobType, 'demontage')
  assert.equal(result.materials.length, exportModel.items.length)
  assert.equal(result.materials[0].id, exportModel.items[0].itemNumber)
  assert.equal(result.materials[0].qty, exportModel.items[0].quantity)
  assert.equal(result.materials[0].unitPrice, exportModel.items[0].unitPrice)
  assert.equal(result.materials[1].system, exportModel.meta.system)
  assert.equal(sumMaterials(result.materials), sumMaterials(exportModel.items))
})
