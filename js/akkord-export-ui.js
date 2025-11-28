import { buildAkkordData } from './akkord-data.js';
import { exportPDFBlob } from './export-pdf.js';
import { exportZipFromAkkord } from './export-zip.js';
import { handleImportAkkord } from './import-akkord.js';
import { buildAkkordJsonPayload } from './export-json.js';

let buildAkkordDataImpl = buildAkkordData;
let exportPDFBlobImpl = exportPDFBlob;
let exportZipFromAkkordImpl = exportZipFromAkkord;
let handleImportAkkordImpl = handleImportAkkord;

export function initExportPanel() {
  bind('#btn-print-akkord', handlePrintAkkord);
  bind('#btn-export-akkord-pdf', handleExportAkkordPDF);
  bind('#btn-export-akkord-zip', handleExportAkkordZIP);
  bind('#btn-export-akkord-json', handleExportAkkordJSON);
  bind('#btn-import-akkord', (event) => handleImportAkkordAction(event));
}

function bind(sel, fn) {
  const el = document.querySelector(sel);
  if (el) el.addEventListener('click', fn);
}

function notifyHistory(type, detail = {}) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  const payload = {
    type,
    timestamp: Date.now(),
    ...detail,
  };
  window.dispatchEvent(new CustomEvent('cssmate:exported', { detail: payload }));
}

function handlePrintAkkord(event) {
  const button = event?.currentTarget;
  const done = setBusy(button, true);
  window.print();
  notifyAction('Printvindue åbnet.', 'success');
  done();
}

function handleExportAkkordPDF(event) {
  const button = event?.currentTarget;
  const done = setBusy(button, true);
  const data = buildAkkordDataImpl();
  const meta = getExportMeta(data);
  const baseName = buildBaseName(meta);
  exportPDFBlobImpl(data, { skipValidation: false, skipBeregn: false, customSagsnummer: meta.sagsnummer })
    .then((payload) => {
      if (!payload?.blob) throw new Error('Mangler PDF payload');
      const filename = payload.fileName || `${baseName}.pdf`;
      downloadBlob(payload.blob, filename);
      notifyAction('PDF er gemt til din enhed.', 'success');
      notifyHistory('pdf', { baseName, fileName: filename });
    })
    .catch((error) => {
      console.error('PDF export failed', error);
      notifyAction('PDF eksport fejlede. Prøv igen.', 'error');
    })
    .finally(() => done());
}

function handleExportAkkordJSON(event) {
  const button = event?.currentTarget;
  const done = setBusy(button, true);
  try {
    const data = buildAkkordDataImpl();
    const meta = getExportMeta(data);
    const baseName = buildBaseName(meta);
    const payload = buildAkkordJsonPayload(data, baseName);
    if (!payload?.content) {
      notifyAction('Kunne ikke bygge JSON-eksporten.', 'error');
      return;
    }
    const blob = new Blob([payload.content], { type: 'application/json' });
    const fileName = payload.fileName || `${baseName}.json`;
    downloadBlob(blob, fileName);
    notifyAction('Akkordseddel (JSON) er gemt.', 'success');
    notifyHistory('json', { baseName, fileName });
  } catch (error) {
    console.error('JSON export failed', error);
    notifyAction('JSON eksport fejlede. Prøv igen.', 'error');
  } finally {
    done();
  }
}

function handleExportAkkordZIP(event) {
  const button = event?.currentTarget;
  const done = setBusy(button, true);
  const data = buildAkkordDataImpl();
  const baseName = buildBaseName(getExportMeta(data));
  exportZipFromAkkordImpl(data, { baseName })
    .then(() => notifyAction('ZIP er klar til download.', 'success'))
    .catch((err) => {
      console.error('ZIP export failed', err);
      notifyAction('ZIP eksport fejlede. Prøv igen.', 'error');
    })
    .finally(() => done());
}

async function handleImportAkkordAction(event) {
  const button = event?.currentTarget;
  const done = setBusy(button, true);
  try {
    await handleImportAkkordImpl();
    notifyAction('Import gennemført.', 'success');
  } catch (error) {
    console.error('Import akkordseddel failed', error);
    notifyAction('Import fejlede. Prøv igen.', 'error');
  } finally {
    done();
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

function notifyAction(message, variant) {
  if (typeof window !== 'undefined' && typeof window.cssmateUpdateActionHint === 'function') {
    window.cssmateUpdateActionHint(message, variant);
  }
}

function setBusy(button, busy) {
  if (!button) {
    return () => {};
  }
  if (busy) {
    if (button.dataset.busy === '1') return () => {};
    button.dataset.busy = '1';
    button.disabled = true;
    button.classList.add('is-busy');
    return () => setBusy(button, false);
  }
  delete button.dataset.busy;
  button.disabled = false;
  button.classList.remove('is-busy');
  return () => {};
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

export {
  handleExportAkkordPDF,
  handleExportAkkordZIP,
  handleExportAkkordJSON,
  handleImportAkkordAction,
  handlePrintAkkord,
};
