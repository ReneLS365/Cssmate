export function buildAkkordJsonPayload(data, baseName, options = {}) {
  const safeData = data || {};
  const safeBaseName = sanitizeFilename(baseName || options.customSagsnummer || 'akkordseddel');

  try {
    if (typeof window !== 'undefined' && typeof window.cssmateBuildAkkordJsonPayload === 'function') {
      const payload = window.cssmateBuildAkkordJsonPayload({
        data: safeData,
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
    }
  } catch (error) {
    console.error('JSON eksport fejlede', error);
    return null;
  }

  return {
    fileName: `${safeBaseName}.json`,
    content: JSON.stringify(safeData, null, 2),
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
