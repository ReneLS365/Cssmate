import { buildExportModel } from './export-model.js';
import { buildExportFileBaseName, buildJobSnapshot } from './job-snapshot.js';
import { SCHEMA_VERSION } from './job-snapshot.js';

export function buildAkkordJsonPayload(data, baseName, options = {}) {
  const exportedAt = options.exportedAt || new Date().toISOString();
  const fallbackBaseName = sanitizeFilename(baseName || options.customSagsnummer || buildExportFileBaseName(new Date(exportedAt)));
  const baseModel = (data?.meta?.caseNumber && Array.isArray(data?.items))
    ? { ...data, meta: { ...data.meta, exportedAt: data.meta.exportedAt || exportedAt } }
    : buildExportModel(data, { exportedAt });
  const rawData = options.rawData ?? options.raw ?? data;
  const payload = buildJobSnapshot({
    rawData,
    model: baseModel,
    exportedAt,
    baseName: fallbackBaseName,
  });

  if (payload?.schemaVersion !== SCHEMA_VERSION) {
    throw new Error('Ugyldigt akkordseddel-format');
  }

  return {
    fileName: `${fallbackBaseName}.json`,
    content: JSON.stringify(payload, null, 2),
    baseName: fallbackBaseName,
  };
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
