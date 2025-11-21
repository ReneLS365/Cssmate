function normalizePdfData(data) {
  if (!data) return undefined;
  if (data.legacy) return data.legacy;
  if (data.meta && data.linjer) {
    const info = data.meta;
    const akkord = data.akkord || {};
    const materials = (data.linjer || []).map(line => ({
      id: line.varenr,
      name: line.navn,
      quantity: line.antal,
      price: line.stkPris,
      system: line.system,
      kategori: line.kategori,
      enhed: line.enhed,
    }));
    return {
      info: {
        sagsnummer: info.sagsnummer,
        kunde: info.kunde,
        adresse: info.adresse,
        navn: info.beskrivelse,
        dato: info.dato,
      },
      materials,
      extras: {
        km: akkord.kmBelob,
        slaebeBelob: akkord.slaebBelob,
        slaebePct: akkord.slaebProcent,
        ekstraarbejde: akkord.ekstraarbejde,
      },
      totals: {
        materialer: akkord.totalMaterialer,
        projektsum: akkord.totalAkkord,
      },
    };
  }
  return data;
}

export async function exportPDFBlob(data) {
  if (typeof window !== 'undefined' && typeof window.cssmateExportPDFBlob === 'function') {
    return window.cssmateExportPDFBlob(undefined, {
      skipValidation: true,
      skipBeregn: true,
      data: normalizePdfData(data),
    });
  }
  console.error('PDF eksport er ikke tilgængelig.');
  return null;
}
