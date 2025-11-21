import { buildAkkordData } from './akkord-data.js';
import { exportPDFBlob } from './export-pdf.js';
import { exportZipFromAkkord } from './export-zip.js';
import { handleImportAkkord } from './import-akkord.js';

export function initExportPanel() {
  bind('#btn-print-akkord', handlePrintAkkord);
  bind('#btn-export-akkord-pdf', handleExportAkkordPDF);
  bind('#btn-export-akkord-zip', handleExportAkkordZIP);
  bind('#btn-export-akkord-json', handleExportAkkordJSON);
  bind('#btn-import-akkord', handleImportAkkord);
}

function bind(sel, fn) {
  const el = document.querySelector(sel);
  if (el) el.addEventListener('click', fn);
}

function handlePrintAkkord() {
  window.print();
}

function handleExportAkkordPDF() {
  const data = buildAkkordData();
  exportPDFBlob(data).then((payload) => {
    if (!payload?.blob) return;
    const filename = payload.fileName || `${data.meta?.sagsnummer || 'akkordseddel'}-akkordseddel.pdf`;
    downloadBlob(payload.blob, filename);
  });
}

function handleExportAkkordJSON() {
  const data = buildAkkordData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `${data.meta?.sagsnummer || 'akkordseddel'}-akkordseddel.json`);
}

function handleExportAkkordZIP() {
  const data = buildAkkordData();
  exportZipFromAkkord(data).catch((err) => {
    console.error('ZIP export failed', err);
  });
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
