import { ensureZipLib } from '../src/features/export/lazy-libs.js';
import { exportPDFBlob } from './export-pdf.js';
import { buildAkkordCSV } from './akkord-csv.js';

function sanitizeFilename(value) {
  return (value || 'akkord')
    .toString()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9-_]+/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getSagsnummer(data) {
  const fallback = 'akkordseddel';
  if (!data) return fallback;
  return data.meta?.sagsnummer || data.info?.sagsnummer || fallback;
}

function buildZipBaseName(data) {
  const info = data?.meta || data?.info || {};
  const parts = ['akkord'];
  if (info.kunde) parts.push(info.kunde);
  if (info.sagsnummer) parts.push(info.sagsnummer);
  const dato = info.dato || new Date().toISOString().slice(0, 10);
  if (dato) parts.push(dato);
  const sanitized = parts.map(sanitizeFilename).filter(Boolean);
  return sanitized.length ? sanitized.join('-') : 'akkordseddel';
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

function notifyZipExport(detail) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  const payload = {
    files: Array.isArray(detail?.files) ? detail.files : [],
    baseName: detail?.baseName || '',
    zipName: detail?.zipName || '',
    timestamp: detail?.timestamp || Date.now(),
  };
  window.dispatchEvent(new CustomEvent('cssmate:zip-exported', { detail: payload }));
}

export async function exportZipFromAkkord(data) {
  const { JSZip } = await ensureZipLib();
  const zip = new JSZip();
  const safeData = data || {};
  const sagsnummer = getSagsnummer(safeData);
  const baseName = buildZipBaseName(safeData);

  const files = [];

  const jsonName = `${baseName}.json`;
  const json = JSON.stringify(safeData, null, 2);
  zip.file(jsonName, json);
  files.push(jsonName);

  try {
    const pdfPayload = await exportPDFBlob(safeData, {
      skipValidation: false,
      skipBeregn: false,
      customSagsnummer: sagsnummer,
    });
    if (pdfPayload?.blob) {
      const pdfName = pdfPayload.fileName || `${baseName}.pdf`;
      zip.file(pdfName, pdfPayload.blob);
      files.push(pdfName);
    }
  } catch (error) {
    console.error('PDF eksport fejlede', error);
  }

  try {
    const csv = buildAkkordCSV(safeData);
    const csvName = `${baseName}.csv`;
    zip.file(csvName, csv);
    files.push(csvName);
  } catch (error) {
    console.error('CSV eksport fejlede', error);
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const zipName = `${baseName}.zip`;
  downloadBlob(blob, zipName);
  notifyZipExport({ baseName, zipName, files });
}
