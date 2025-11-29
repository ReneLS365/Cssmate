import { ensureExportLibs } from '../src/features/export/lazy-libs.js';
import { buildExportModel, formatDkk } from './export-model.js';

export async function exportPDFBlob(data, options = {}) {
  const model = options?.model || buildExportModel(data);
  const skipValidation = options.skipValidation ?? false;
  const skipBeregn = options.skipBeregn ?? false;
  const customSagsnummer = options.customSagsnummer;

  if (typeof window !== 'undefined' && typeof window.cssmateExportPDFBlob === 'function') {
    return window.cssmateExportPDFBlob(customSagsnummer, {
      skipValidation,
      skipBeregn,
      data: model,
    });
  }
  try {
    const { jsPDF } = await ensureExportLibs();
    const doc = new jsPDF();
    const meta = model?.meta || {};
    const totals = model?.totals || {};
    const baseName = sanitizeFilename(customSagsnummer || meta.caseNumber || 'akkordseddel');
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

    addLine('Sagsnummer', meta.caseNumber || '-');
    addLine('Kunde', meta.customer || '-');
    addLine('Adresse', meta.address || '-');
    addLine('Navn/opgave', meta.caseName || '-');
    addLine('Dato', meta.date || '-');
    addLine('System', meta.system || '-');

    y += 4;
    doc.setFontSize(14);
    doc.text('Summer', 14, y);
    y += 8;

    const materialSum = Number(totals.materials ?? 0) || 0;
    const extraSum = Number(totals.extras ?? totals.extrasBreakdown?.extraWork ?? 0) || 0;
    const akkordSum = Number(totals.akkord ?? 0) || materialSum + extraSum;
    const projectSum = Number(totals.project ?? totals.akkord ?? 0) || akkordSum;

    addLine('Materialer', `${formatDkk(materialSum)} kr`);
    addLine('Ekstraarbejde', `${formatDkk(extraSum)} kr`);
    addLine('Akkordsum', `${formatDkk(akkordSum)} kr`);
    addLine('Projektsum', `${formatDkk(projectSum)} kr`);

    y += 4;
    doc.setFontSize(14);
    doc.text('Tillæg og ekstraarbejde', 14, y);
    y += 8;

    const extras = model?.extras || {};
    const breakdown = totals.extrasBreakdown || {};
    addLine('KM', `${formatDkk(breakdown.km || extras?.km?.amount || 0)} kr ( ${formatDkk(extras?.km?.quantity || 0)} km )`);
    addLine('Slæb', `${formatDkk(breakdown.slaeb || extras?.slaeb?.amount || 0)} kr (${extras?.slaeb?.percent || 0} %)`);
    addLine('Tralleløft', `${formatDkk(breakdown.tralle || extras?.tralle?.amount || 0)} kr`);
    const extraWorkLines = Array.isArray(extras.extraWork) ? extras.extraWork.filter(entry => entry?.amount) : [];
    if (extraWorkLines.length) {
      const extraWorkTotal = extraWorkLines.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
      addLine('Øvrigt ekstraarbejde', `${formatDkk(extraWorkTotal)} kr`);
    }

    const workers = model?.wage?.workers || [];
    if (workers.length) {
      y += 4;
      doc.setFontSize(14);
      doc.text('Løn', 14, y);
      y += 8;
      workers.forEach(worker => {
        const workerLabel = `${worker.hours ?? 0} t x ${formatDkk(worker.rate ?? 0)} kr = ${formatDkk(worker.total ?? 0)} kr`;
        addLine(worker.name || 'Medarbejder', workerLabel);
      });
    }

    const blob = doc.output('blob');
    return { blob, baseName, fileName: `${baseName}.pdf` };
  } catch (error) {
    console.error('PDF eksport er ikke tilgængelig.', error);
    throw error;
  }
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
