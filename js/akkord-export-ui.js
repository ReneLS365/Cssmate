import { buildAkkordData } from './akkord-data.js';
import { handleImportAkkord } from './import-akkord.js';
import { buildAkkordJsonPayload } from './export-json.js';
import { buildExportModel } from './export-model.js';
import { buildExportFileBaseName, buildJobSnapshot } from './job-snapshot.js';
import { appendHistoryEntry } from './storageHistory.js';
import { publishSharedCase } from './shared-ledger.js';

function isDebugExportEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location?.search || '');
    const flagFromQuery = params.get('debugExport');
    const flagFromStorage = window.localStorage?.getItem?.('debugExport');
    return flagFromQuery === '1' || flagFromStorage === '1';
  } catch {
    return false;
  }
}

function getDebugBuffer() {
  if (typeof window === 'undefined') return null;
  if (!isDebugExportEnabled()) return null;
  if (!window.__exportDebug) window.__exportDebug = [];
  return window.__exportDebug;
}

function exportDebugLog(event, detail = {}) {
  const buffer = getDebugBuffer();
  if (!buffer) return;
  buffer.push({ event, detail, ts: Date.now() });
}

function downloadBlob(blob, fileName) {
  if (!blob || typeof document === 'undefined' || typeof URL === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  if (!a) return;
  a.href = url;
  a.download = typeof fileName === 'string' && fileName.trim() ? fileName : 'download';
  a.rel = 'noopener';
  if (document.body?.appendChild) {
    document.body.appendChild(a);
  }
  exportDebugLog('download_trigger', { fileName: a.download });
  if (typeof a.click === 'function') {
    a.click();
  }
  if (typeof a.remove === 'function') a.remove();
  const revoke = () => {
    try { URL.revokeObjectURL(url); } catch {}
  };
  const timer = typeof window !== 'undefined' && typeof window.setTimeout === 'function'
    ? window.setTimeout
    : setTimeout;
  timer(revoke, 1500);
}

let buildAkkordDataImpl = buildAkkordData;
let buildAkkordJsonPayloadImpl = buildAkkordJsonPayload;
let handleImportAkkordImpl = handleImportAkkord;
let buildJobSnapshotImpl = buildJobSnapshot;
let publishSharedCaseImpl = publishSharedCase;

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

function buildHistoryMetaFromContext(context) {
  const info = context?.model?.info || {};
  const meta = context?.model?.meta || {};
  const formatDate = (value) => {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.valueOf())) return '';
    try {
      return new Intl.DateTimeFormat('sv-SE').format(date);
    } catch {
      return date.toISOString().slice(0, 10);
    }
  };
  return {
    sagsnummer: info.sagsnummer || meta.caseNumber || '',
    navn: info.navn || meta.caseName || '',
    adresse: info.adresse || meta.address || '',
    kunde: info.kunde || meta.customer || '',
    dato: formatDate(info.dato || meta.date || context.exportedAt),
    montoer: info.montoer || info.worker || meta.montoer || '',
  };
}

function saveExportHistory(context) {
  if (!context?.snapshot) return null;
  try {
    const createdAt = Date.now();
    const timeZone = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
    const tzOffsetMin = new Date(createdAt).getTimezoneOffset();
    const entry = {
      createdAt,
      createdAtMs: createdAt,
      updatedAt: createdAt,
      updatedAtMs: createdAt,
      tzOffsetMin,
      timeZone,
      meta: buildHistoryMetaFromContext(context),
      totals: context.model?.totals || {},
      payload: context.snapshot,
      source: 'export',
    };
    const saved = appendHistoryEntry(entry);
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('cssmate:history:updated'));
    }
    return saved;
  } catch (error) {
    console.warn('Kunne ikke gemme eksport-historik', error);
    return null;
  }
}

export async function exportAkkordJsonAndPdf(options = {}) {
  const button = options?.button || options?.currentTarget;
  const done = setBusy(button, true, { busyText: 'Publicerer…', doneText: 'Publiceret' });
  const exportErrors = [];
  try {
    notifyAction('Publicerer sag til fælles ledger…', 'info');
    const context = buildExportContext();
    context.historySaved = Boolean(saveExportHistory(context));
    const jsonResult = (() => {
      try {
        return exportJsonFromContext(context, { skipDownload: true });
      } catch (error) {
        exportErrors.push(error);
        console.error('JSON export failed', error);
        const fallback = 'Der opstod en fejl under JSON-eksporten. Prøv igen – eller kontakt kontoret.';
        const message = error?.message ? `${fallback} (${error.message})` : fallback;
        notifyAction(message, 'error');
        return null;
      }
    })();

    if (!jsonResult) {
      throw exportErrors[0] || new Error('Eksport mislykkedes');
    }

    await publishSharedCaseImpl({
      teamId: `sscaff-team-${window?.TEAM_ID || 'default'}`,
      jobNumber: context.meta?.sagsnummer || context.model?.meta?.caseNumber,
      caseKind: (context.model?.meta?.jobType || 'montage').toLowerCase(),
      system: context.model?.meta?.system || (context.model?.meta?.systems || [])[0] || '',
      status: 'kladde',
      totals: {
        materials: context.model?.totals?.materials || 0,
        montage: context.model?.meta?.jobType === 'montage' ? context.model?.totals?.project : 0,
        demontage: context.model?.meta?.jobType === 'demontage' ? context.model?.totals?.project : 0,
        total: context.model?.totals?.project || context.model?.totals?.akkord || 0,
      },
      jsonContent: jsonResult.content,
    });

    notifyAction('Sag publiceret til fælles sager.', 'success');
    return { jsonFileName: jsonResult.fileName };
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

  function exportJsonFromContext(context, { skipDownload = false } = {}) {
    const payload = buildAkkordJsonPayloadImpl(context.model, context.baseName, {
      exportedAt: context.exportedAt?.toISOString?.() || context.exportedAt,
      rawData: context.data,
    });
    if (!payload?.content) throw new Error('Kunne ikke bygge JSON-eksporten');
    let content = payload.content;
    try {
      const parsed = JSON.parse(payload.content);
      if (parsed && parsed.job && typeof parsed.job === 'object') {
        if (!parsed.meta && parsed.job.meta) parsed.meta = parsed.job.meta;
        if (!parsed.items && parsed.job.items) parsed.items = parsed.job.items;
        if (!parsed.materials && parsed.job.materials) parsed.materials = parsed.job.materials;
        if (!parsed.info && parsed.job.info) parsed.info = parsed.job.info;
        if (!parsed.totals && parsed.job.totals) parsed.totals = parsed.job.totals;
        content = JSON.stringify(parsed, null, 2);
      }
    } catch {}
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const fileName = payload.fileName || `${context.baseName}.json`;
    exportDebugLog('json_blob', { size: blob.size });
    if (!skipDownload) {
      downloadBlob(blob, fileName);
      notifyAction('Akkordseddel (JSON) er gemt.', 'success');
      notifyHistory('json', { baseName: context.baseName, fileName, historySaved: context?.historySaved });
    }
    return { fileName, blob, content };
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
  buildAkkordJsonPayloadImpl = typeof overrides.buildAkkordJsonPayload === 'function'
    ? overrides.buildAkkordJsonPayload
    : buildAkkordJsonPayload;
  buildJobSnapshotImpl = typeof overrides.buildJobSnapshot === 'function'
    ? overrides.buildJobSnapshot
    : buildJobSnapshot;
  handleImportAkkordImpl = typeof overrides.handleImportAkkord === 'function'
    ? overrides.handleImportAkkord
    : handleImportAkkord;
  publishSharedCaseImpl = typeof overrides.publishSharedCase === 'function'
    ? overrides.publishSharedCase
    : publishSharedCase;
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
