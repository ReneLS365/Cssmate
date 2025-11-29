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
  const done = setBusy(button, true, { busyText: 'Åbner print…', doneText: 'Klar' });
  window.print();
  notifyAction('Printvindue åbnet.', 'success');
  done();
}

async function handleExportAkkordPDF(event) {
  const button = event?.currentTarget;
  const done = setBusy(button, true, { busyText: 'Eksporterer PDF…', doneText: 'PDF klar' });
  try {
    notifyAction('Eksporterer akkordseddel (PDF)…', 'info');
    const data = buildAkkordDataImpl();
    if (!data) throw new Error('Mangler data til PDF');
    const meta = getExportMeta(data);
    const baseName = buildBaseName(meta);
    const payload = await exportPDFBlobImpl(data, { skipValidation: false, skipBeregn: false, customSagsnummer: meta.sagsnummer });
    if (!payload?.blob) throw new Error('Mangler PDF payload');
    const filename = payload.fileName || `${baseName}.pdf`;
    downloadBlob(payload.blob, filename);
    notifyAction('PDF er gemt til din enhed.', 'success');
    notifyHistory('pdf', { baseName, fileName: filename });
  } catch (error) {
    console.error('PDF export failed', error);
    const fallback = 'Der opstod en fejl under PDF-eksporten. Prøv igen – eller kontakt kontoret.';
    const message = error?.message ? `${fallback} (${error.message})` : fallback;
    notifyAction(message, 'error');
  } finally {
    done();
  }
}

function handleExportAkkordJSON(event) {
  const button = event?.currentTarget;
  const done = setBusy(button, true, { busyText: 'Eksporterer JSON…', doneText: 'JSON klar' });
  try {
    notifyAction('Eksporterer akkordseddel (JSON)…', 'info');
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
    notifyAction('Der opstod en fejl under JSON-eksporten. Prøv igen – eller kontakt kontoret.', 'error');
  } finally {
    done();
  }
}

function handleExportAkkordZIP(event) {
  const button = event?.currentTarget;
  const done = setBusy(button, true, { busyText: 'Pakker ZIP…', doneText: 'ZIP klar' });
  const data = buildAkkordDataImpl();
  const baseName = buildBaseName(getExportMeta(data));
  notifyAction('Pakker ZIP med PDF/JSON…', 'info');
  exportZipFromAkkordImpl(data, { baseName })
    .then(({ zipName, files } = {}) => {
      notifyAction('ZIP er klar til download.', 'success');
      notifyHistory('zip', { baseName, fileName: zipName, files });
    })
    .catch((err) => {
      console.error('ZIP export failed', err);
      const fallback = 'Der opstod en fejl under ZIP-eksporten. Prøv igen – eller kontakt kontoret.';
      const message = err?.message ? `${fallback} (${err.message})` : fallback;
      notifyAction(message, 'error');
    })
    .finally(() => done());
}

async function handleImportAkkordAction(event) {
  const button = event?.currentTarget;
  const done = setBusy(button, true, { busyText: 'Importerer…', doneText: 'Import klar' });
  try {
    await handleImportAkkordImpl();
    notifyAction('Import gennemført.', 'success');
  } catch (error) {
    console.error('Import akkordseddel failed', error);
    const fallback = 'Der opstod en fejl under importen. Prøv igen – eller kontakt kontoret.';
    const message = error?.message ? `${fallback} (${error.message})` : fallback;
    notifyAction(message, 'error');
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

function setBusy(button, busy, options = {}) {
  if (!button) {
    return () => {};
  }
  const { busyText, doneText, revertDelay = 1200 } = options;
  if (busy) {
    if (button.dataset.busy === '1') return () => {};
    button.dataset.busy = '1';
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent || '';
    }
    button.disabled = true;
    button.classList.add('is-busy');
    button.setAttribute('aria-busy', 'true');
    if (busyText) {
      button.textContent = busyText;
    }
    return (finalText) => setBusy(button, false, { ...options, doneText: finalText || doneText });
  }
  delete button.dataset.busy;
  button.disabled = false;
  button.classList.remove('is-busy');
  button.removeAttribute('aria-busy');
  const originalText = button.dataset.originalText || button.textContent || '';
  if (doneText) {
    button.textContent = doneText;
    window.setTimeout(() => {
      button.textContent = originalText;
    }, revertDelay);
  } else {
    button.textContent = originalText;
  }
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
