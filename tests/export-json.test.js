import assert from 'node:assert/strict'
import test from 'node:test'
import { buildExportModel } from '../js/export-model.js'
import { buildAkkordJsonPayload } from '../js/export-json.js'

test('buildAkkordJsonPayload preserves jobFactor from raw data', () => {
  const rawData = {
    meta: {
      sagsnummer: 'DEM-FACTOR',
      jobType: 'demontage',
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
        stkPris: 100,
        linjeBelob: 200,
      },
    ],
    jobFactor: 0.5,
  }

  const exportedAt = '2024-05-10T12:00:00.000Z'
  const model = buildExportModel(rawData, { exportedAt })
  const payload = JSON.parse(buildAkkordJsonPayload(model, model.meta.caseNumber, { rawData, exportedAt }).content)

  assert.equal(payload.job.jobFactor, rawData.jobFactor)
  assert.equal(payload.job.jobType, rawData.meta.jobType)
})
