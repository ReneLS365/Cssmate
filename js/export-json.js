import { buildExportModel } from './export-model.js';

export function buildAkkordJsonPayload(data, baseName, options = {}) {
  const baseModel = (data?.meta?.caseNumber && Array.isArray(data?.items))
    ? { ...data, meta: { ...data.meta, exportedAt: data.meta.exportedAt || options.exportedAt || new Date().toISOString() } }
    : buildExportModel(data, { exportedAt: options.exportedAt });
  const normalizedJobType = (baseModel.jobType || baseModel.meta?.jobType || data?.jobType || 'montage');
  const payload = {
    ...baseModel,
    version: '2.0',
    source: 'cssmate',
    jobType: normalizedJobType,
    meta: { ...baseModel.meta, version: '2.0', source: 'cssmate' },
  };
  const safeBaseName = sanitizeFilename(baseName || model?.meta?.caseNumber || options.customSagsnummer || 'akkordseddel');
  const windowData = data && data.info ? data : null;
  const canUseWindowBuilder = options.useWindowBuilder === true
    && typeof window !== 'undefined'
    && typeof window.cssmateBuildAkkordJsonPayload === 'function'
    && windowData;

  if (canUseWindowBuilder) {
    try {
      const payload = window.cssmateBuildAkkordJsonPayload({
        data: windowData,
        customSagsnummer: safeBaseName,
        skipValidation: true,
        skipBeregn: true,
        ...options,
      });
      if (payload?.content) {
        return {
          fileName: payload.fileName || `${safeBaseName}.json`,
          content: payload.content,
          baseName: payload.baseName || safeBaseName,
        };
      }
    } catch (error) {
      console.error('JSON eksport fejlede', error);
    }
  }

  return {
    fileName: `${safeBaseName}.json`,
    content: JSON.stringify(payload, null, 2),
    baseName: safeBaseName,
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
