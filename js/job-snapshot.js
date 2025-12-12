import { buildAkkordData } from './akkord-data.js';
import { buildExportModel } from './export-model.js';

const SCHEMA_VERSION = 'cssmate.job.v1';

function detectAppInfo() {
  const version = (typeof window !== 'undefined' && window.CSSMATE_APP_VERSION)
    || (typeof self !== 'undefined' && self.CSSMATE_APP_VERSION)
    || 'dev';

  return { name: 'Cssmate', version };
}

function formatTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}_${hours}-${minutes}`;
}

export function buildExportFileBaseName(date = new Date()) {
  return `Akkordseddel_${formatTimestamp(date)}`;
}

export function buildJobSnapshot(options = {}) {
  const exportedAt = options.exportedAt || new Date().toISOString();
  const exportDate = new Date(exportedAt);
  const baseName = options.baseName || buildExportFileBaseName(exportDate);
  const rawData = options.rawData || buildAkkordData(options.raw);
  const model = options.model || buildExportModel(rawData, { exportedAt });

  const job = {
    id: rawData?.meta?.sagsnummer || rawData?.info?.sagsnummer || model?.meta?.caseNumber || baseName,
    jobType: model?.meta?.jobType || rawData?.jobType || 'montage',
    version: '2.0',
    source: 'cssmate',
    exportedAt,
    meta: { ...model.meta, exportedAt },
    info: model.info,
    systems: Array.isArray(model?.meta?.systems) ? model.meta.systems : [],
    materials: model.materials,
    items: model.items,
    extras: model.extras,
    extraInputs: model.extraInputs,
    totals: model.totals,
    wage: model.wage,
    jobFactor: rawData?.jobFactor ?? 1,
    excelSystems: rawData?.excelSystems || rawData?.meta?.excelSystems || model?.meta?.systems || [],
    tralleState: rawData?.tralleState || {},
    cache: rawData?.cache || null,
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt,
    app: detectAppInfo(),
    baseName,
    job,
  };
}

export { SCHEMA_VERSION };
