import { BOSTA_DATA, HAKI_DATA, MODEX_DATA } from '../../dataset.js'
import { ensureSheetJs } from '../features/export/sheetjs-loader.js'

const SYSTEM_DATA = {
  bosta: BOSTA_DATA,
  haki: HAKI_DATA,
  modex: MODEX_DATA
}

export function getSystemDataset(systemId) {
  return SYSTEM_DATA[systemId] || [];
}

const TEMPLATE_PATHS = {
  bosta: '/akkord/Bosta25.xlsx',
  haki: '/akkord/HAKI25.xlsx',
  modex: '/akkord/MODEX25.xlsx',
};

const ALLOWED_SYSTEMS = Object.keys(TEMPLATE_PATHS);

function sanitizeFilename(value) {
  return (value || 'akkordseddel')
    .toString()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9-_]+/gi, '_');
}

function getLatestJobSnapshot(jobOverride) {
  if (jobOverride) return jobOverride;
  if (typeof window !== 'undefined' && window.__cssmateLastEkompletData) {
    return window.__cssmateLastEkompletData;
  }
  return null;
}

function normalizeSystem(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function selectSystem(job) {
  const forced = normalizeSystem(job?.system || job?.systemOverride);
  if (ALLOWED_SYSTEMS.includes(forced)) {
    return forced;
  }

  const primary = normalizeSystem(job?.primarySystem);
  if (ALLOWED_SYSTEMS.includes(primary)) {
    return primary;
  }

  if (Array.isArray(job?.systems)) {
    for (const system of job.systems) {
      const normalized = normalizeSystem(system);
      if (ALLOWED_SYSTEMS.includes(normalized)) {
        return normalized;
      }
    }
  }

  if (Array.isArray(job?.materialer)) {
    const counters = new Map();
    job.materialer.forEach(line => {
      const key = normalizeSystem(line?.systemKey || line?.system);
      if (!ALLOWED_SYSTEMS.includes(key)) return;
      const qty = Number(line?.quantity ?? line?.qty ?? 0);
      if (!Number.isFinite(qty) || qty <= 0) return;
      counters.set(key, (counters.get(key) || 0) + qty);
    });
    const sorted = Array.from(counters.entries()).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
      return sorted[0][0];
    }
  }

  return '';
}

function normalizeSystemList(value) {
  if (!value && value !== 0) return [];
  const list = Array.isArray(value)
    ? value
    : (typeof value === 'string' || (value && typeof value[Symbol.iterator] === 'function')
        ? Array.from(value)
        : [value]);
  const unique = [];
  list.forEach(entry => {
    const normalized = normalizeSystem(entry);
    if (ALLOWED_SYSTEMS.includes(normalized) && !unique.includes(normalized)) {
      unique.push(normalized);
    }
  });
  return unique;
}

function resolveSystems(job, override) {
  const overrideList = normalizeSystemList(override);
  if (overrideList.length > 0) {
    return overrideList;
  }
  if (Array.isArray(job?.systems)) {
    const jobList = normalizeSystemList(job.systems);
    if (jobList.length > 0) {
      return jobList;
    }
  }
  const fallback = selectSystem(job);
  return fallback ? [fallback] : [];
}

function buildExcelFilename(job, system) {
  const caseNo = job?.sagsinfo?.sagsnummer || job?.caseNo || job?.id || 'sag';
  const safeCase = sanitizeFilename(caseNo) || 'sag';
  const systemLabel = (system || '').toString().toUpperCase();
  return `Akkordseddel_${safeCase}_${systemLabel || 'SYSTEM'}.xlsx`;
}

async function loadTemplate(system, xlsx) {
  const templatePath = TEMPLATE_PATHS[system];
  if (!templatePath) {
    throw new Error(`Ukendt system: ${system}`);
  }
  const response = await fetch(templatePath);
  if (!response.ok) {
    throw new Error(`Kunne ikke hente template: ${templatePath}`);
  }
  const buffer = await response.arrayBuffer();
  const workbook = xlsx.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Mangler dataark i template: ${templatePath}`);
  }
  return { workbook, sheet };
}

function shouldIncludeManualLines(job, system) {
  const selected = Array.isArray(job?.systems)
    ? job.systems.map(normalizeSystem).filter(Boolean)
    : [];
  const supported = selected.filter(value => ALLOWED_SYSTEMS.includes(value));
  if (supported.length === 0) {
    return false;
  }
  if (supported.length === 1) {
    return supported[0] === system;
  }
  return false;
}

function buildNameToQtyMap(job, system) {
  const lines = Array.isArray(job?.materialer) ? job.materialer : [];
  const includeManual = shouldIncludeManualLines(job, system);
  const map = new Map();

  lines.forEach(line => {
    const name = (line?.name || line?.label || '').trim();
    const qty = Number(line?.quantity ?? line?.qty ?? 0);
    if (!name || !Number.isFinite(qty) || qty <= 0) {
      return;
    }
    const lineSystem = normalizeSystem(line?.systemKey || line?.system);
    if (lineSystem && lineSystem !== system) {
      return;
    }
    if (!lineSystem && !includeManual) {
      return;
    }
    map.set(name, (map.get(name) || 0) + qty);
  });

  return map;
}

function fillLines(sheet, nameToQty, xlsx) {
  const range = xlsx.utils.decode_range(sheet['!ref']);
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    const columns = [
      { labelCol: 0, priceCol: 1, qtyCol: 2, totalCol: 3 },
      { labelCol: 4, priceCol: 5, qtyCol: 6, totalCol: 7 },
    ];
    columns.forEach(({ labelCol, priceCol, qtyCol, totalCol }) => {
      const labelAddress = xlsx.utils.encode_cell({ r: row, c: labelCol });
      const labelValue = sheet[labelAddress]?.v ? String(sheet[labelAddress].v).trim() : '';
      if (!labelValue || !nameToQty.has(labelValue)) {
        return;
      }
      const qtyValue = nameToQty.get(labelValue);
      const qtyAddress = xlsx.utils.encode_cell({ r: row, c: qtyCol });
      const totalAddress = xlsx.utils.encode_cell({ r: row, c: totalCol });
      const priceAddress = xlsx.utils.encode_cell({ r: row, c: priceCol });
      sheet[qtyAddress] = { t: 'n', v: qtyValue };
      sheet[totalAddress] = { t: 'n', f: `${priceAddress}*${qtyAddress}` };
    });
  }
}

function fillHeader(sheet, job) {
  const info = job?.sagsinfo || {};
  const date = info.dato || job?.dato || new Date().toLocaleDateString('da-DK');
  const assignments = [
    ['B2', info.adresse || ''],
    ['B3', info.navn || ''],
    ['B4', info.kunde || ''],
    ['B5', info.sagsnummer || ''],
    ['F2', date],
  ];
  assignments.forEach(([cell, value]) => {
    if (!cell) return;
    if (!sheet[cell]) {
      sheet[cell] = { t: 's', v: value || '' };
    } else {
      sheet[cell].v = value || '';
    }
  });
}

// Eksporter seneste job som Excel-ark baseret på valgte systemer
export async function exportAkkordExcelForActiveJob(jobOverride, systemOverride) {
  const job = getLatestJobSnapshot(jobOverride);
  if (!job) {
    console.warn('Excel-akkord eksport sprang over – ingen aktive data.');
    return [];
  }

  const systems = resolveSystems(job, systemOverride);
  if (systems.length === 0) {
    console.warn('Excel-akkord eksport sprang over – ingen understøttede systemer valgt.');
    return [];
  }

  let xlsx;
  try {
    xlsx = await ensureSheetJs();
  } catch (error) {
    console.error('Kunne ikke indlæse SheetJS til Excel eksport.', error);
    return [];
  }

  const results = [];
  for (const system of systems) {
    if (!ALLOWED_SYSTEMS.includes(system)) continue;
    try {
      const { workbook, sheet } = await loadTemplate(system, xlsx);
      const nameToQty = buildNameToQtyMap(job, system);
      fillHeader(sheet, job);
      fillLines(sheet, nameToQty, xlsx);

      const output = xlsx.write(workbook, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      results.push({
        system,
        blob,
        fileName: buildExcelFilename(job, system),
      });
    } catch (error) {
      console.error('Excel-akkord eksport fejlede for system:', system, error);
    }
  }

  return results;
}
