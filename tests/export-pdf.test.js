import assert from 'node:assert/strict';
import test from 'node:test';
import { exportPDFBlob } from '../js/export-pdf.js';
import { buildExportModel } from '../js/export-model.js';

async function blobToBuffer(blob) {
  if (blob?.arrayBuffer) {
    return Buffer.from(await blob.arrayBuffer());
  }
  if (Buffer.isBuffer(blob)) return blob;
  if (blob instanceof Uint8Array) return Buffer.from(blob);
  return Buffer.from(String(blob || ''));
}

function createReferenceLikeData() {
  return {
    info: {
      sagsnummer: 'REF-123',
      navn: 'Stillads montage',
      adresse: 'Eksempelvej 42',
      kunde: 'Test A/S',
      dato: '2024-05-20',
      montoer: 'Montør A, Montør B',
    },
    linjer: [
      {
        linjeNr: 1,
        system: 'bosta',
        kategori: 'test',
        varenr: 'MAT-001',
        navn: 'Spindelfod kort',
        enhed: 'stk',
        antal: 20,
        stkPris: 2.99,
        linjeBelob: 59.51,
      },
      {
        linjeNr: 2,
        system: 'bosta',
        kategori: 'test',
        varenr: 'MAT-002',
        navn: 'Ramme 2,0m',
        enhed: 'stk',
        antal: 4,
        stkPris: 125,
        linjeBelob: 500,
      },
    ],
    wage: {
      workers: [
        { name: 'Montør A', type: 'Montage', hours: 6.5, rate: 277.6, total: 1804.42, allowances: { udd: 'udd2' } },
        { name: 'Montør B', type: 'Demontage', hours: 4, rate: 250, total: 1000 },
      ],
      totals: { hours: 10.5, sum: 2804.42 },
    },
    extras: {
      km: { quantity: 12, amount: 104.4 },
      slaeb: { percent: 5, amount: 75 },
      tralle: { lifts35: 1, lifts50: 0, amount: 104.4 },
      extraWork: [
        { type: 'Boring af huller', quantity: 3, amount: 150 },
        { type: 'Lukning af huller', quantity: 2, amount: 80 },
        { type: 'Boring i beton', quantity: 1, amount: 120 },
      ],
    },
    totals: {
      materials: 559.51,
      extras: 633.3,
      akkord: 3193.23,
      project: 3193.23,
    },
  };
}

test('exportPDFBlob skaber akkordseddel med reference-overskrifter', async () => {
  const data = createReferenceLikeData();
  const model = buildExportModel(data);

  const { blob, fileName } = await exportPDFBlob(data, { model, skipValidation: true, skipBeregn: true });
  assert.ok(blob, 'PDF-blob findes');
  assert.ok(fileName.endsWith('.pdf'), 'Filnavn slutter med .pdf');

  const pdfBuffer = await blobToBuffer(blob);
  assert.ok(pdfBuffer.length > 1000, 'PDF ser ud til at indeholde indhold');

  const pdfText = pdfBuffer.toString('latin1');
  const expectedHeadings = ['Akkordseddel', 'Sagsinfo', 'Materialer', 'Løn', 'Oversigt:', 'Løn & projektsum'];
  expectedHeadings.forEach((heading) => {
    assert.ok(pdfText.includes(heading), `PDF indeholder overskriften ${heading}`);
  });
});

