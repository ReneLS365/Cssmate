import { ensureZipLib } from '../src/features/export/lazy-libs.js';
import { exportPDFBlob } from './export-pdf.js';
import { buildAkkordCSV } from './akkord-csv.js';
import { exportExcelFromAkkordData } from '../src/export/akkord-excel.js';
import { buildAkkordJsonPayload } from './export-json.js';
import { buildExportModel } from './export-model.js';

let ensureZipLibImpl = ensureZipLib;
let exportPDFBlobImpl = exportPDFBlob;

export function setZipExportDependencies(overrides = {}) {
  ensureZipLibImpl = typeof overrides.ensureZipLib === 'function' ? overrides.ensureZipLib : ensureZipLib;
  exportPDFBlobImpl = typeof overrides.exportPDFBlob === 'function' ? overrides.exportPDFBlob : exportPDFBlob;
}

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
  const parts = [];
  if (info.sagsnummer) parts.push(info.sagsnummer);
  if (info.kunde) parts.push(info.kunde);
  const dato = (info.dato || data?.createdAt || new Date().toISOString()).slice(0, 10);
  if (dato) parts.push(dato);
  const sanitized = parts.map(sanitizeFilename).filter(Boolean);
  return sanitized.length ? sanitized.join('-') : 'akkordseddel';
}

function normalizeExcelSystems(values) {
  if (!values) return [];
  const list = Array.isArray(values)
    ? values
    : (typeof values === 'string'
      ? [values]
      : (values && typeof values[Symbol.iterator] === 'function'
        ? Array.from(values)
        : []));
  const unique = [];
  list.forEach(entry => {
    const normalized = (entry || '').toString().trim().toLowerCase();
    if (!normalized) return;
    if (!unique.includes(normalized)) {
      unique.push(normalized);
    }
  });
  return unique;
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

export async function exportZipFromAkkord(data, options = {}) {
  const { JSZip } = await ensureZipLibImpl();
  const zip = new JSZip();
  const safeData = data || {};
  const model = buildExportModel(safeData, { exportedAt: options.exportedAt });
  const sagsnummer = getSagsnummer(model) || getSagsnummer(safeData);
  const baseName = sanitizeFilename(options.baseName || model?.meta?.caseNumber || safeData.baseName || buildZipBaseName(model));
  const zipBaseName = `${baseName || 'akkordseddel'}-export`;

  const files = [];
  const excelSelection = normalizeExcelSystems(options.excelSystems || safeData.excelSystems || safeData.meta?.excelSystems);
  const folders = {
    pdf: zip.folder('pdf'),
    json: zip.folder('json'),
    excel: zip.folder('excel'),
    csv: zip.folder('csv'),
  };

  try {
    const jsonPayload = buildAkkordJsonPayload(model, baseName, { skipValidation: true, skipBeregn: true });
    if (!jsonPayload?.content) throw new Error('JSON eksport fejlede');
    const jsonPath = folders.json ? `json/${jsonPayload.fileName}` : jsonPayload.fileName;
    (folders.json || zip).file(jsonPayload.fileName, jsonPayload.content);
    files.push(jsonPath);

    const pdfPayload = await exportPDFBlobImpl(model, {
      skipValidation: false,
      skipBeregn: false,
      customSagsnummer: sagsnummer,
      model,
    });
    if (!pdfPayload?.blob) throw new Error('PDF eksport fejlede');
    const pdfName = pdfPayload.fileName || `${baseName}.pdf`;
    const pdfPath = folders.pdf ? `pdf/${pdfName}` : pdfName;
    (folders.pdf || zip).file(pdfName, pdfPayload.blob);
    files.push(pdfPath);

    try {
      const csv = buildAkkordCSV(model);
      const csvName = `${baseName}.csv`;
      const csvPath = folders.csv ? `csv/${csvName}` : csvName;
      (folders.csv || zip).file(csvName, csv);
      files.push(csvPath);
    } catch (error) {
      console.error('CSV eksport fejlede', error);
    }

    if (excelSelection.length > 0) {
      const excelPayloads = await exportExcelFromAkkordData(model, excelSelection);
      if (!excelPayloads.length) {
        console.warn('Excel eksport springes over: ingen understøttede templates for valgt system');
      } else {
        excelPayloads.forEach(entry => {
          if (!entry?.blob || !entry?.fileName) return;
          const path = folders.excel ? `excel/${entry.fileName}` : entry.fileName;
          (folders.excel || zip).file(entry.fileName, entry.blob);
          files.push(path);
        });
      }
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const zipName = `${zipBaseName}.zip`;
    downloadBlob(blob, zipName);
    notifyZipExport({ baseName, zipName, files });
    if (typeof window !== 'undefined' && typeof window.cssmateUpdateActionHint === 'function') {
      window.cssmateUpdateActionHint('ZIP med PDF, JSON og Excel er gemt.', 'success');
    }
    return { zipName, files };
  } catch (error) {
    console.error('ZIP eksport fejlede', error);
    if (typeof window !== 'undefined' && typeof window.cssmateUpdateActionHint === 'function') {
      window.cssmateUpdateActionHint('ZIP eksport fejlede. Prøv igen.', 'error');
    }
    throw error;
  }
}
