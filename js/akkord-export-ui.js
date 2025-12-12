import { buildAkkordData } from './akkord-data.js';
import { exportPDFBlob } from './export-pdf.js';
import { handleImportAkkord } from './import-akkord.js';
import { buildAkkordJsonPayload } from './export-json.js';
import { buildExportModel } from './export-model.js';
import { buildExportFileBaseName, buildJobSnapshot } from './job-snapshot.js';

let buildAkkordDataImpl = buildAkkordData;
let exportPDFBlobImpl = exportPDFBlob;
let buildAkkordJsonPayloadImpl = buildAkkordJsonPayload;
let handleImportAkkordImpl = handleImportAkkord;
let buildJobSnapshotImpl = buildJobSnapshot;

  export function initExportPanel() {
    bind('#btn-print-akkord', handlePrintAkkord);
    bind('#btn-export-akkord-pdf', handleExportAkkordPDF);
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

export async function exportAkkordJsonAndPdf(options = {}) {
  const button = options?.button || options?.currentTarget;
  const done = setBusy(button, true, { busyText: 'Eksporterer…', doneText: 'Filer klar' });
  const exportErrors = [];
  try {
    notifyAction('Eksporterer akkordseddel (JSON + PDF)…', 'info');
    const context = buildExportContext();
    const jsonResult = (() => {
      try {
        return exportJsonFromContext(context);
      } catch (error) {
        exportErrors.push(error);
        console.error('JSON export failed', error);
        const fallback = 'Der opstod en fejl under JSON-eksporten. Prøv igen – eller kontakt kontoret.';
        const message = error?.message ? `${fallback} (${error.message})` : fallback;
        notifyAction(message, 'error');
        return null;
      }
    })();
    await waitForDownloadTick();

    const pdfResult = await exportPdfFromContext(context).catch(error => {
      exportErrors.push(error);
      console.error('PDF export failed', error);
      const fallback = 'Der opstod en fejl under PDF-eksporten. Prøv igen – eller kontakt kontoret.';
      const message = error?.message ? `${fallback} (${error.message})` : fallback;
      notifyAction(message, 'error');
      return null;
    });
    await waitForDownloadTick();

    if (exportErrors.length === 2 || !jsonResult || !pdfResult) {
      throw exportErrors[0] || new Error('Eksport mislykkedes');
    }

    return { jsonFileName: jsonResult.fileName, pdfFileName: pdfResult.fileName };
  } catch (error) {
    console.error('Export failed', error);
    const fallback = 'Der opstod en fejl under eksporten. Prøv igen – eller kontakt kontoret.';
    const message = error?.message ? `${fallback} (${error.message})` : fallback;
    notifyAction(message, 'error');
    throw error;
  } finally {
    done();
  }
}

function handlePrintAkkord(event) {
  const button = event?.currentTarget;
  const done = setBusy(button, true, { busyText: 'Åbner print…', doneText: 'Klar' });
  window.print();
  notifyAction('Printvindue åbnet.', 'success');
  done();
}

  async function handleExportAkkordPDF(event) {
    return exportAkkordJsonAndPdf({ button: event?.currentTarget });
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
  const timer = typeof window !== 'undefined' && typeof window.setTimeout === 'function'
    ? window.setTimeout
    : setTimeout;
  timer(() => URL.revokeObjectURL(url), 1000);
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
    sagsnummer: meta.caseNumber || meta.sagsnummer || data?.info?.sagsnummer || 'akkordseddel',
    kunde: meta.customer || meta.kunde || data?.info?.kunde || '',
    dato: (meta.date || meta.dato || data?.info?.dato || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
  };
}

function buildExportContext() {
  const exportedAt = new Date();
  const data = buildAkkordDataImpl();
  if (!data || typeof data !== 'object') throw new Error('Mangler data til eksport');
  const model = buildExportModel(data, { exportedAt: exportedAt.toISOString() });
  if (!model || typeof model !== 'object') throw new Error('Kunne ikke bygge eksportmodel');
  const snapshot = buildJobSnapshotImpl({ rawData: data, model, exportedAt: exportedAt.toISOString() });
  const baseName = sanitizeFilename(snapshot?.baseName || buildExportFileBaseName(exportedAt));
  const meta = getExportMeta(model);
  return { data, model, meta, baseName, snapshot, exportedAt };
}

async function exportPdfFromContext(context) {
  const payload = await exportPDFBlobImpl(context.data, {
    skipValidation: false,
    skipBeregn: false,
    customSagsnummer: context.meta.sagsnummer,
    model: context.model,
    rawData: context.data,
  });
  if (!payload?.blob) throw new Error('Mangler PDF payload');
  const filename = ensurePdfExtension(`${context.baseName}.pdf`);
  downloadBlob(payload.blob, filename);
  notifyAction('PDF er gemt til din enhed.', 'success');
  notifyHistory('pdf', { baseName: context.baseName, fileName: filename });
  return { fileName: filename, blob: payload.blob };
}

function exportJsonFromContext(context) {
  const payload = buildAkkordJsonPayloadImpl(context.model, context.baseName, {
    exportedAt: context.exportedAt?.toISOString?.() || context.exportedAt,
    rawData: context.data,
  });
  if (!payload?.content) throw new Error('Kunne ikke bygge JSON-eksporten');
  const blob = new Blob([payload.content], { type: 'application/json;charset=utf-8' });
  const fileName = payload.fileName || `${context.baseName}.json`;
  downloadBlob(blob, fileName);
  notifyAction('Akkordseddel (JSON) er gemt.', 'success');
  notifyHistory('json', { baseName: context.baseName, fileName });
  return { fileName, blob };
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
  buildAkkordJsonPayloadImpl = typeof overrides.buildAkkordJsonPayload === 'function'
    ? overrides.buildAkkordJsonPayload
    : buildAkkordJsonPayload;
  buildJobSnapshotImpl = typeof overrides.buildJobSnapshot === 'function'
    ? overrides.buildJobSnapshot
    : buildJobSnapshot;
  handleImportAkkordImpl = typeof overrides.handleImportAkkord === 'function'
    ? overrides.handleImportAkkord
    : handleImportAkkord;
}

export {
  handleExportAkkordPDF,
  handleImportAkkordAction,
  handlePrintAkkord,
};

function waitForDownloadTick(delay = 150) {
  return new Promise(resolve => {
    const timer = typeof window !== 'undefined' && typeof window.setTimeout === 'function'
      ? window.setTimeout
      : setTimeout;
    timer(resolve, delay);
  });
}

function ensurePdfExtension(filename) {
  if (typeof filename !== 'string') return `${sanitizeFilename(filename || 'akkordseddel')}.pdf`;
  return filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`;
}
