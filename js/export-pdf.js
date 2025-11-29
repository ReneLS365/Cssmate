import { ensureExportLibs } from '../src/features/export/lazy-libs.js';

function normalizePdfData(data) {
  if (!data) return undefined;
  if (data.legacy) return data.legacy;
  if (data.meta && data.linjer) {
    const info = data.meta;
    const akkord = data.akkord || {};
    const extrasList = Array.isArray(akkord.ekstraarbejde) ? akkord.ekstraarbejde : [];
    const pickExtra = (type) => extrasList.find(entry => entry?.type === type) || {};
    const boringHuller = pickExtra('Boring af huller');
    const lukningAfHuller = pickExtra('Lukning af huller');
    const boringIBeton = pickExtra('Boring i beton');
    const opskydeligt = pickExtra('Opskydeligt rækværk');
    const tralleløft = pickExtra('Tralleløft');
    const tralle35 = pickExtra('Tralle 35');
    const tralle50 = pickExtra('Tralle 50');
    const tralleSum = Number(tralleløft.belob ?? 0) || 0;
    const extrasTotals = (
      Number(akkord.kmBelob ?? 0)
      + Number(akkord.slaebBelob ?? 0)
      + Number(boringHuller.belob ?? 0)
      + Number(lukningAfHuller.belob ?? 0)
      + Number(boringIBeton.belob ?? 0)
      + Number(opskydeligt.belob ?? 0)
      + tralleSum
    );
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
        km: Number(akkord.kmBelob ?? 0) || 0,
        slaebeBelob: Number(akkord.slaebBelob ?? 0) || 0,
        slaebePct: Number(akkord.slaebProcent ?? 0) || 0,
        ekstraarbejde: akkord.ekstraarbejde,
        huller: Number(boringHuller.belob ?? 0) || 0,
        lukAfHul: Number(lukningAfHuller.belob ?? 0) || 0,
        boring: Number(boringIBeton.belob ?? 0) || 0,
        opskydeligt: Number(opskydeligt.belob ?? 0) || 0,
        tralleløft: tralleSum,
        traelle35: Number(tralle35.antal ?? 0) || 0,
        traelle50: Number(tralle50.antal ?? 0) || 0,
      },
      totals: {
        materialer: Number(akkord.totalMaterialer ?? 0) || 0,
        ekstraarbejde: extrasTotals,
        slaeb: Number(akkord.slaebBelob ?? 0) || 0,
        projektsum: akkord.totalAkkord ?? ((Number(akkord.totalMaterialer ?? 0) || 0) + extrasTotals),
        samletAkkordsum: akkord.totalAkkord ?? ((Number(akkord.totalMaterialer ?? 0) || 0) + extrasTotals),
        akkordsum: akkord.totalAkkord ?? ((Number(akkord.totalMaterialer ?? 0) || 0) + extrasTotals),
        montoerLonMedTillaeg: 0,
      },
      extraInputs: {
        boringHuller: Number(boringHuller.antal ?? 0) || 0,
        lukHuller: Number(lukningAfHuller.antal ?? 0) || 0,
        boringBeton: Number(boringIBeton.antal ?? 0) || 0,
        opskydeligt: Number(opskydeligt.antal ?? 0) || 0,
        km: Number(akkord.km ?? 0) || 0,
        slaebePctInput: Number(akkord.slaebProcent ?? 0) || 0,
      },
      tralleState: {
        n35: Number(tralle35.antal ?? 0) || 0,
        n50: Number(tralle50.antal ?? 0) || 0,
        sum: tralleSum,
      },
      tralleSum,
      slaebePctInput: Number(akkord.slaebProcent ?? 0) || 0,
      slaebeBelob: Number(akkord.slaebBelob ?? 0) || 0,
      jobType: data.jobType || 'montage',
      jobFactor: data.jobFactor || 1,
      labor: [],
      laborTotals: [],
      totalHours: 0,
      cache: null,
    };
  }
  return data;
}

export async function exportPDFBlob(data, options = {}) {
  const normalizedData = normalizePdfData(data);
  const skipValidation = options.skipValidation ?? false;
  const skipBeregn = options.skipBeregn ?? false;
  const customSagsnummer = options.customSagsnummer;

  if (typeof window !== 'undefined' && typeof window.cssmateExportPDFBlob === 'function') {
    return window.cssmateExportPDFBlob(customSagsnummer, {
      skipValidation,
      skipBeregn,
      data: normalizedData,
    });
  }
  try {
    const { jsPDF } = await ensureExportLibs();
    const doc = new jsPDF();
    const info = normalizedData?.info || {};
    const totals = normalizedData?.totals || {};
    const baseName = sanitizeFilename(customSagsnummer || info.sagsnummer || 'akkordseddel');
    let y = 16;

    doc.setFontSize(16);
    doc.text('Akkordseddel', 14, y);
    y += 10;

    const addLine = (label, value) => {
      const text = `${label}: ${value}`;
      const lines = doc.splitTextToSize(text, 180);
      lines.forEach(line => {
        if (y > 280) {
          doc.addPage();
          y = 16;
        }
        doc.text(line, 14, y);
        y += 8;
      });
    };

    addLine('Sagsnummer', info.sagsnummer || '-');
    addLine('Kunde', info.kunde || '-');
    addLine('Adresse', info.adresse || '-');
    addLine('Navn/opgave', info.navn || '-');
    addLine('Dato', info.dato || '-');
    addLine('Montørnavne', info.montoer || '-');

    y += 4;
    doc.setFontSize(14);
    doc.text('Summer', 14, y);
    y += 8;

    const materialSum = Number(totals.materialer ?? totals.totalMaterialer ?? 0) || 0;
    const extraSum = Number(totals.ekstraarbejde ?? 0) || 0;
    const projectSum = Number(totals.projektsum ?? totals.totalAkkord ?? totals.samletAkkordsum ?? 0) || 0;

    addLine('Materialer', `${formatCurrency(materialSum)} kr`);
    addLine('Ekstraarbejde', `${formatCurrency(extraSum)} kr`);
    addLine('Projektsum', `${formatCurrency(projectSum)} kr`);

    const blob = doc.output('blob');
    return { blob, baseName, fileName: `${baseName}.pdf` };
  } catch (error) {
    console.error('PDF eksport er ikke tilgængelig.', error);
    throw error;
  }
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
