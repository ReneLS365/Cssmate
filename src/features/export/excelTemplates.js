import { ensureExcelLib } from './lazy-libs.js';
import { normalizeKey } from '../../lib/string-utils.js';

const EXCEL_MANIFEST_URL = './src/data/excel/templates.json';
let manifestPromise = null;

function sanitizeFilename(value) {
  return (value || 'akkordseddel')
    .toString()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9-_]+/gi, '_');
}

function toArrayBuffer(response) {
  if (!response) return null;
  if (typeof response.arrayBuffer === 'function') {
    return response.arrayBuffer();
  }
  return Promise.resolve(null);
}

async function fetchManifest() {
  if (manifestPromise) return manifestPromise;
  if (typeof fetch !== 'function') {
    manifestPromise = Promise.resolve({ templates: [], version: 1 });
    return manifestPromise;
  }

  manifestPromise = fetch(EXCEL_MANIFEST_URL, { cache: 'no-store' })
    .then(async response => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      if (!data || typeof data !== 'object') return { templates: [], version: 1 };
      const templates = Array.isArray(data.templates) ? data.templates : [];
      const cleaned = templates
        .map(template => ({
          id: template.id || template.system || 'template',
          system: template.system || template.id || '',
          label: template.label || template.name || template.system || template.id || 'Skabelon',
          file: template.file || template.path || '',
        }))
        .filter(entry => typeof entry.file === 'string' && entry.file.length > 0);
      return { templates: cleaned, version: data.version || 1 };
    })
    .catch(error => {
      console.warn('Kunne ikke indlæse Excel manifest', error);
      return { templates: [], version: 1 };
    });

  return manifestPromise;
}

async function fetchTemplateBinary(file) {
  if (!file) return null;
  try {
    const response = await fetch(file, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await toArrayBuffer(response);
  } catch (error) {
    console.warn('Excel skabelon kunne ikke hentes', file, error);
    return null;
  }
}

function ensureUniqueSheetName(workbook, name) {
  const clean = (name || 'Data').toString().replace(/[\\/?*\[\]:]/g, ' ').trim() || 'Data';
  let sheetName = clean.slice(0, 28);
  let suffix = 1;
  const existing = new Set(Array.isArray(workbook?.SheetNames) ? workbook.SheetNames : []);
  while (existing.has(sheetName) || sheetName.length === 0) {
    const next = `${clean.slice(0, 25)}_${suffix++}`;
    sheetName = next.slice(0, 31) || `Data_${suffix}`;
  }
  return sheetName;
}

function createSystemSheetData(system, payload, XLSX) {
  if (!system || !payload || !Array.isArray(payload.systemBreakdown)) return null;
  const target = payload.systemBreakdown.find(entry => normalizeKey(entry.key || entry.label) === normalizeKey(system));
  if (!target || !Array.isArray(target.items) || !target.items.length) return null;
  const rows = [['Id', 'Navn', 'Antal', 'Pris', 'Linjesum']];
  target.items.forEach(item => {
    const qty = Number.isFinite(item.quantity) ? item.quantity : 0;
    const price = Number.isFinite(item.price) ? item.price : 0;
    rows.push([
      item.id || '',
      item.name || '',
      qty,
      price,
      qty * price,
    ]);
  });
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  return { sheet, name: target.label || target.key || 'System' };
}

function appendWorkbookSheets(target, source, XLSX) {
  if (!target || !source || !Array.isArray(source.SheetNames)) return;
  source.SheetNames.forEach(originalName => {
    const sheet = source.Sheets?.[originalName];
    if (!sheet) return;
    const name = ensureUniqueSheetName(target, originalName);
    target.Sheets[name] = sheet;
    if (!Array.isArray(target.SheetNames)) {
      target.SheetNames = [];
    }
    if (!target.SheetNames.includes(name)) {
      target.SheetNames.push(name);
    }
  });
}

export async function buildExcelWorkbooks(payload, options = {}) {
  if (!payload) return [];
  const { XLSX } = await ensureExcelLib();
  if (!XLSX) return [];

  const manifest = await fetchManifest();
  const baseName = sanitizeFilename(payload.baseName || payload.originalName || 'akkordseddel');
  const workbooks = [];

  const dataWorkbook = typeof payload.toWorkbook === 'function' ? payload.toWorkbook() : null;
  if (options.includeBaseWorkbook !== false && dataWorkbook) {
    const array = XLSX.write(dataWorkbook, { bookType: 'xlsx', type: 'array' });
    workbooks.push({
      id: 'akkord',
      label: 'Akkordoversigt',
      fileName: `${baseName}.xlsx`,
      blob: new Blob([array], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    });
  }

  if (!Array.isArray(manifest.templates) || manifest.templates.length === 0) {
    return workbooks;
  }

  for (const template of manifest.templates) {
    const buffer = await fetchTemplateBinary(template.file);
    let workbook;
    if (buffer) {
      try {
        workbook = XLSX.read(buffer, { type: 'array' });
      } catch (error) {
        console.warn('Kunne ikke læse Excel skabelon som workbook', template.file, error);
        workbook = XLSX.utils.book_new();
      }
    } else {
      workbook = XLSX.utils.book_new();
    }

    if (dataWorkbook) {
      appendWorkbookSheets(workbook, dataWorkbook, XLSX);
    }

    const systemSheet = createSystemSheetData(template.system, payload, XLSX);
    if (systemSheet) {
      const uniqueName = ensureUniqueSheetName(workbook, systemSheet.name);
      XLSX.utils.book_append_sheet(workbook, systemSheet.sheet, uniqueName);
    }

    if (!Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0) {
      const sheet = XLSX.utils.aoa_to_sheet([['Ingen data tilgængelig']]);
      XLSX.utils.book_append_sheet(workbook, sheet, ensureUniqueSheetName(workbook, 'Data'));
    }

    const fileLabel = template.label || template.id || 'Skabelon';
    const fileSuffix = template.id ? `-${sanitizeFilename(template.id)}` : '';
    const fileName = `${baseName}${fileSuffix || ''}.xlsx`;
    const out = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    workbooks.push({
      id: template.id || template.system || fileLabel,
      label: fileLabel,
      templateFile: template.file,
      fileName,
      blob: new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    });
  }

  return workbooks;
}

export async function prefetchExcelTemplates() {
  try {
    await fetchManifest();
  } catch (error) {
    console.warn('Excel manifest kunne ikke for-indlæses', error);
  }
}
