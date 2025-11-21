export async function exportPDFBlob(data) {
  if (typeof window !== 'undefined' && typeof window.cssmateExportPDFBlob === 'function') {
    return window.cssmateExportPDFBlob(undefined, {
      skipValidation: true,
      skipBeregn: true,
      data,
    });
  }
  console.error('PDF eksport er ikke tilgængelig.');
  return null;
}
