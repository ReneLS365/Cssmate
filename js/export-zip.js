import { ensureZipLib } from '../src/features/export/lazy-libs.js';
import { exportPDFBlob } from './export-pdf.js';
import { buildAkkordCSV } from './akkord-csv.js';

function getSagsnummer(data) {
  const fallback = 'akkordseddel';
  if (!data) return fallback;
  return data.meta?.sagsnummer || data.info?.sagsnummer || fallback;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function exportZipFromAkkord(data) {
  const { JSZip } = await ensureZipLib();
  const zip = new JSZip();
  const safeData = data || {};
  const sagsnummer = getSagsnummer(safeData);
  const baseName = `${sagsnummer}-akkordseddel`;

  const json = JSON.stringify(safeData, null, 2);
  zip.file(`${baseName}.json`, json);

  const pdfPayload = await exportPDFBlob(safeData);
  if (pdfPayload?.blob) {
    zip.file(`${baseName}.pdf`, pdfPayload.blob);
  }

  try {
    const csv = buildAkkordCSV(safeData);
    zip.file(`${baseName}.csv`, csv);
  } catch (error) {
    console.error('CSV eksport fejlede', error);
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `${baseName}.zip`);
}
