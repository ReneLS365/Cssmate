import { buildAkkordData } from './akkord-data.js';
import { exportPDFBlob } from './export-pdf.js';
import { exportZipFromAkkord } from './export-zip.js';
import { handleImportAkkord } from './import-akkord.js';

let buildAkkordDataImpl = buildAkkordData;
let exportPDFBlobImpl = exportPDFBlob;
let exportZipFromAkkordImpl = exportZipFromAkkord;
let handleImportAkkordImpl = handleImportAkkord;

export function initExportPanel() {
  bind('#btn-print-akkord', handlePrintAkkord);
  bind('#btn-export-akkord-pdf', handleExportAkkordPDF);
  bind('#btn-export-akkord-zip', handleExportAkkordZIP);
  bind('#btn-export-akkord-json', handleExportAkkordJSON);
  bind('#btn-import-akkord', () => handleImportAkkordAction());
}

function bind(sel, fn) {
  const el = document.querySelector(sel);
  if (el) el.addEventListener('click', fn);
}

function handlePrintAkkord() {
  window.print();
}

function handleExportAkkordPDF() {
  const data = buildAkkordDataImpl();
  const meta = getExportMeta(data);
  const baseName = buildBaseName(meta);
  exportPDFBlobImpl(data, { skipValidation: false, skipBeregn: false, customSagsnummer: meta.sagsnummer })
    .then((payload) => {
      if (!payload?.blob) throw new Error('Mangler PDF payload');
      const filename = payload.fileName || `${baseName}.pdf`;
      downloadBlob(payload.blob, filename);
      notifyAction('PDF er gemt til din enhed.', 'success');
    })
    .catch((error) => {
      console.error('PDF export failed', error);
      notifyAction('PDF eksport fejlede. Prøv igen.', 'error');
    });
}

function handleExportAkkordJSON() {
  const data = buildAkkordDataImpl();
  const meta = getExportMeta(data);
  const baseName = buildBaseName(meta);
  const payload = buildJsonPayload(data, baseName);
  if (!payload?.content) {
    notifyAction('Kunne ikke bygge JSON-eksporten.', 'error');
    return;
  }
  const blob = new Blob([payload.content], { type: 'application/json' });
  downloadBlob(blob, payload.fileName || `${baseName}.json`);
  notifyAction('Akkordseddel (JSON) er gemt.', 'success');
}

function handleExportAkkordZIP() {
  const data = buildAkkordDataImpl();
  const baseName = buildBaseName(getExportMeta(data));
  exportZipFromAkkordImpl(data, { baseName })
    .then(() => notifyAction('ZIP er klar til download.', 'success'))
    .catch((err) => {
      console.error('ZIP export failed', err);
      notifyAction('ZIP eksport fejlede. Prøv igen.', 'error');
    });
}

async function handleImportAkkordAction() {
  try {
    await handleImportAkkordImpl();
  } catch (error) {
    console.error('Import akkordseddel failed', error);
    notifyAction('Import fejlede. Prøv igen.', 'error');
  }
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

function sanitizeFilename(value) {
  return (value || 'akkord')
    .toString()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9-_]+/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getExportMeta(data) {
  const meta = data?.meta || data?.info || {};
  return {
    sagsnummer: meta.sagsnummer || data?.info?.sagsnummer || 'akkordseddel',
    kunde: meta.kunde || data?.info?.kunde || '',
    dato: (meta.dato || data?.info?.dato || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
  };
}

function buildBaseName(meta) {
  const parts = [meta.sagsnummer, meta.kunde, meta.dato].filter(Boolean);
  return sanitizeFilename(parts.join('-') || 'akkordseddel');
}

function buildJsonPayload(data, baseName) {
  if (typeof window !== 'undefined' && typeof window.cssmateBuildAkkordJsonPayload === 'function') {
    const payload = window.cssmateBuildAkkordJsonPayload({
      data,
      customSagsnummer: baseName,
      skipValidation: true,
      skipBeregn: true,
    });
    if (payload?.content) return payload;
  }
  return { content: JSON.stringify(data, null, 2), fileName: `${baseName}.json` };
}

function notifyAction(message, variant) {
  if (typeof window !== 'undefined' && typeof window.cssmateUpdateActionHint === 'function') {
    window.cssmateUpdateActionHint(message, variant);
  }
}

export function setExportDependencies(overrides = {}) {
  buildAkkordDataImpl = typeof overrides.buildAkkordData === 'function'
    ? overrides.buildAkkordData
    : buildAkkordData;
  exportPDFBlobImpl = typeof overrides.exportPDFBlob === 'function'
    ? overrides.exportPDFBlob
    : exportPDFBlob;
  exportZipFromAkkordImpl = typeof overrides.exportZipFromAkkord === 'function'
    ? overrides.exportZipFromAkkord
    : exportZipFromAkkord;
  handleImportAkkordImpl = typeof overrides.handleImportAkkord === 'function'
    ? overrides.handleImportAkkord
    : handleImportAkkord;
}
