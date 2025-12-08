import { ensureExportLibs } from '../src/features/export/lazy-libs.js';
import { buildExportModel, formatDkk } from './export-model.js';

const NUMBER_FORMATTER = new Intl.NumberFormat('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatNumber(value) {
  const num = Number(value) || 0;
  return NUMBER_FORMATTER.format(num);
}

function formatCurrency(value) {
  return `${formatDkk(value)} kr`;
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export async function exportPDFBlob(data, options = {}) {
  const model = options?.model || (data ? buildExportModel(data) : null);
  const rawData = options?.rawData || data;
  const skipValidation = options.skipValidation ?? false;
  const skipBeregn = options.skipBeregn ?? false;
  const customSagsnummer = options.customSagsnummer;
  const providedLibs = options.exportLibs;

  if (!model || typeof model !== 'object') {
    throw new Error('Mangler exportmodel til PDF');
  }

  if (typeof window !== 'undefined' && typeof window.cssmateExportPDFBlob === 'function') {
    return window.cssmateExportPDFBlob(customSagsnummer, {
      skipValidation,
      skipBeregn,
      data: coerceRawExportData(rawData, model),
    });
  }

  try {
    const { jsPDF } = providedLibs || await ensureExportLibs();
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

    const meta = model?.meta || {};
    const info = model?.info || {};
    const totals = model?.totals || {};
    const wageTotals = model?.wage?.totals || {};
    const extras = model?.extras || {};
    const breakdown = totals.extrasBreakdown || {};
    const baseName = sanitizeFilename(customSagsnummer || meta.caseNumber || 'akkordseddel');

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    const usableWidth = pageWidth - margin * 2;
    const lineHeight = 6;
    const boxPadding = 4;
    let y = margin;

    const ensureSpace = (height = lineHeight) => {
      if (y + height > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }
    };

    const addSectionTitle = (title) => {
      ensureSpace(lineHeight * 2);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text(title, margin, y);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      y += lineHeight + 2;
    };

    const addKeyValueGrid = (entries, columns = 2) => {
      if (!Array.isArray(entries) || entries.length === 0) return;
      const colWidth = usableWidth / columns;

      for (let i = 0; i < entries.length; i += columns) {
        const rowEntries = entries.slice(i, i + columns);
        let rowHeight = lineHeight;
        rowEntries.forEach((entry, idx) => {
          const value = entry?.value ?? '-';
          const label = entry?.label ?? '';
          const x = margin + idx * colWidth;
          const valueLines = doc.splitTextToSize(String(value), colWidth - 30);
          rowHeight = Math.max(rowHeight, valueLines.length * lineHeight);
          ensureSpace(rowHeight + 2);
          doc.setFont('helvetica', 'bold');
          doc.text(`${label}:`, x, y);
          doc.setFont('helvetica', 'normal');
          valueLines.forEach((line, lineIndex) => {
            doc.text(line, x + 28, y + lineIndex * lineHeight);
          });
        });
        y += rowHeight + 2;
      }
    };

    const drawTableRow = (columns, linesPerCell, rowTop, rowHeight, isHeader = false) => {
      let cursorX = margin;
      columns.forEach((col, cellIndex) => {
        const lines = linesPerCell[cellIndex] || [''];
        doc.rect(cursorX, rowTop, col.width, rowHeight);
        const textX = col.align === 'right' ? cursorX + col.width - 2 : cursorX + 2;
        doc.setFont('helvetica', isHeader ? 'bold' : 'normal');
        lines.forEach((line, lineIndex) => {
          const textY = rowTop + boxPadding + lineIndex * lineHeight;
          const align = col.align === 'right' ? 'right' : 'left';
          doc.text(line, textX, textY, { align });
        });
        cursorX += col.width;
      });
    };

    const addTable = (title, columns, rows) => {
      addSectionTitle(title);
      if (!rows || rows.length === 0) {
        ensureSpace(lineHeight);
        doc.text('Ingen data', margin, y);
        y += lineHeight;
        return;
      }

      const headerLines = columns.map(col => [col.label]);
      const headerHeight = Math.max(...headerLines.map(lines => lines.length)) * lineHeight + boxPadding;
      ensureSpace(headerHeight + 2);
      drawTableRow(columns, headerLines, y, headerHeight, true);
      y += headerHeight;

      rows.forEach(row => {
        const cellLines = columns.map(col => {
          const rawValue = typeof col.value === 'function' ? col.value(row) : row[col.key];
          const asText = rawValue != null ? String(rawValue) : '';
          return doc.splitTextToSize(asText || '', col.width - 4);
        });
        const rowHeight = Math.max(...cellLines.map(lines => lines.length || 1)) * lineHeight + boxPadding;
        ensureSpace(rowHeight + 2);
        drawTableRow(columns, cellLines, y, rowHeight, false);
        y += rowHeight;
      });
    };

    const addValueBoxes = (entries) => {
      if (!entries || entries.length === 0) return;
      const boxWidth = (usableWidth - boxPadding) / entries.length;
      let boxX = margin;
      entries.forEach(entry => {
        const boxHeight = lineHeight * 2 + boxPadding;
        ensureSpace(boxHeight + 2);
        doc.rect(boxX, y, boxWidth, boxHeight);
        doc.setFont('helvetica', 'bold');
        doc.text(entry.label, boxX + 2, y + lineHeight);
        doc.setFont('helvetica', 'normal');
        doc.text(entry.value, boxX + 2, y + lineHeight * 2);
        boxX += boxWidth + boxPadding;
      });
      y += lineHeight * 2 + boxPadding + 2;
    };

    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('Akkordseddel', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    y += lineHeight + 2;

    const workerNamesList = Array.isArray(model?.wage?.workers)
      ? model.wage.workers.map(w => w.name).filter(Boolean)
      : [];
    const workerNames = (info.montoer || workerNamesList.join(', ') || '').trim();
    addSectionTitle('Sagsinfo');
    addKeyValueGrid([
      { label: 'Sagsnummer', value: meta.caseNumber || '-' },
      { label: 'Navn/opgave', value: meta.caseName || '-' },
      { label: 'Adresse', value: meta.address || '-' },
      { label: 'Kunde', value: meta.customer || '-' },
      { label: 'Dato', value: meta.date || '-' },
      { label: 'Montørnavne', value: workerNames || '-' },
    ]);

    const materialLines = Array.isArray(model?.items) ? model.items : [];
    const materialsSorted = materialLines
      .slice()
      .sort((a, b) => (toNumber(a.lineNumber) || 0) - (toNumber(b.lineNumber) || 0));
    const materialRows = materialsSorted.map(item => {
      const quantity = toNumber(item.quantity ?? item.qty ?? item.amount);
      const unitPrice = toNumber(item.unitPrice ?? item.price ?? item.stkPris ?? item.ackUnitPrice);
      const lineTotal = toNumber(item.lineTotal ?? item.linjeBelob ?? quantity * unitPrice);
      return {
        id: item.itemNumber || item.id || '',
        name: item.name || '',
        quantity: formatNumber(quantity),
        price: formatCurrency(unitPrice),
        total: formatCurrency(lineTotal),
      };
    });

    addTable('Materialer', [
      { key: 'id', label: 'Id', width: 28 },
      { key: 'name', label: 'Materiale', width: 78 },
      { key: 'quantity', label: 'Antal', width: 22, align: 'right' },
      { key: 'price', label: 'Pris', width: 26, align: 'right' },
      { key: 'total', label: 'Lønsum', width: 28, align: 'right' },
    ], materialRows);

    const workers = Array.isArray(model?.wage?.workers) ? model.wage.workers : [];
    const workerRows = workers.map(worker => ({
      type: worker.type || worker.name || '-',
      hours: formatNumber(worker.hours || 0),
      rate: formatCurrency(worker.rate || 0),
      total: formatCurrency(worker.total || 0),
    }));

    addTable('Løn', [
      { key: 'type', label: 'Arbejdstype', width: 78 },
      { key: 'hours', label: 'Timer', width: 24, align: 'right' },
      { key: 'rate', label: 'Sats', width: 28, align: 'right' },
      { key: 'total', label: 'Lønsum', width: 36, align: 'right' },
    ], workerRows);

    const materialSum = toNumber(totals.materials);
    const extraSum = toNumber(totals.extras ?? breakdown.extraWork ?? 0) || (toNumber(breakdown.km) + toNumber(breakdown.slaeb) + toNumber(breakdown.tralle));
    const akkordSum = toNumber(totals.akkord || (materialSum + extraSum));
    const projectSum = toNumber(totals.project || akkordSum);
    const kmQuantity = toNumber(extras?.km?.quantity ?? model?.extraInputs?.km);
    const kmAmount = toNumber(breakdown.km ?? extras?.km?.amount);
    const tralleAmount = toNumber(breakdown.tralle ?? extras?.tralle?.amount);
    const slaebAmount = toNumber(breakdown.slaeb ?? extras?.slaeb?.amount);
    const extraWorkSum = toNumber(breakdown.extraWork ?? 0);
    const hoursTotal = toNumber(wageTotals.hours);
    const wageSum = toNumber(wageTotals.sum);
    const timePrice = hoursTotal > 0 ? akkordSum / hoursTotal : 0;

    addSectionTitle('Oversigt');
    addKeyValueGrid([
      { label: 'Materialer', value: formatCurrency(materialSum) },
      { label: 'Ekstraarbejde', value: formatCurrency(extraWorkSum || extraSum) },
      { label: 'Statik/stilladsdækning', value: formatCurrency(slaebAmount) },
      { label: 'Diverse tillæg', value: formatCurrency(tralleAmount) },
      { label: 'Kilometer', value: `${formatCurrency(kmAmount)} (${formatNumber(kmQuantity)} km)` },
      { label: 'Samlet akkordløn', value: formatCurrency(akkordSum) },
      { label: 'Timer i alt', value: formatNumber(hoursTotal) },
      { label: 'Timepris uden tillæg', value: `${formatDkk(timePrice)} kr` },
      { label: 'Lønsum (brutto)', value: formatCurrency(wageSum) },
      { label: 'Projektsum', value: formatCurrency(projectSum) },
    ], 2);

    addValueBoxes([
      { label: 'Lønsum', value: formatCurrency(wageSum) },
      { label: 'Projektsum', value: formatCurrency(projectSum) },
    ]);

    addSectionTitle('Arbejder');
    if (workers.length === 0) {
      ensureSpace(lineHeight);
      doc.text('Ingen registrerede montører', margin, y);
      y += lineHeight;
    } else {
      workers.forEach((worker, index) => {
        const label = `Mand ${index + 1} (${worker.name || worker.type || 'Montør'}):`;
        const details = `Timer: ${formatNumber(worker.hours || 0)}, Timeløn: ${formatDkk(worker.rate || 0)} kr/t, Total: ${formatCurrency(worker.total || 0)}`;
        const lines = doc.splitTextToSize(`${label} ${details}`, usableWidth);
        lines.forEach(line => {
          ensureSpace(lineHeight);
          doc.text(line, margin, y);
          y += lineHeight;
        });
      });
    }

    addSectionTitle('Oversigt (bund)');
    addKeyValueGrid([
      { label: 'Materialer', value: formatCurrency(materialSum) },
      { label: 'Ekstraarbejde', value: formatCurrency(extraWorkSum || extraSum) },
      { label: 'Statik', value: formatCurrency(slaebAmount) },
      { label: 'Samlet akkordløn', value: formatCurrency(akkordSum) },
      { label: 'Timer', value: formatNumber(hoursTotal) },
      { label: 'Timepris (uden tillæg)', value: `${formatDkk(timePrice)} kr` },
      { label: 'Lønsum', value: formatCurrency(wageSum) },
      { label: 'Projektsum', value: formatCurrency(projectSum) },
      { label: 'Materialesum (info)', value: formatCurrency(materialSum) },
      { label: 'Kilometer (info)', value: `${formatCurrency(kmAmount)} (${formatNumber(kmQuantity)} km)` },
      { label: 'Tralleløft (info)', value: formatCurrency(tralleAmount) },
    ], 2);

    doc.setProperties({
      title: `${meta.caseNumber || 'Akkordseddel'} - Akkordseddel`,
      subject: 'Akkordseddel eksport',
    });

    const output = doc.output('blob');
    const blob = output instanceof Promise ? await output : output;
    return { blob, baseName, fileName: `${baseName}.pdf` };
  } catch (error) {
    console.error('PDF eksport er ikke tilgængelig.', error);
    throw error;
  }
}

function coerceRawExportData(rawData, model) {
  if (rawData && rawData.info) return rawData;
  const safeModel = model || {};

  const mapWorkers = (safeModel?.wage?.workers || []).map(worker => ({
    hours: Number(worker.hours) || 0,
    hourlyWithAllowances: Number(worker.rate) || 0,
    udd: worker.allowances?.udd || '',
    mentortillaeg: Number(worker.allowances?.mentortillaeg) || 0,
  }));

  const mapItems = (safeModel?.items || []).map(item => ({
    id: item.itemNumber || '',
    name: item.name || '',
    quantity: Number(item.quantity) || 0,
    price: Number(item.unitPrice) || 0,
  }));

  const extras = safeModel?.extras || {};
  const totals = safeModel?.totals || {};

  const kmQuantity = Number(extras?.km?.quantity) || 0;
  const kmAmount = Number(extras?.km?.amount) || 0;

  return {
    info: {
      sagsnummer: safeModel?.meta?.caseNumber || 'akkordseddel',
      navn: safeModel?.meta?.caseName || '',
      adresse: safeModel?.meta?.address || '',
      kunde: safeModel?.meta?.customer || '',
      dato: safeModel?.meta?.date || '',
      montoer: mapWorkers.length ? 'Medarbejdere' : '',
    },
    meta: {
      systems: safeModel?.meta?.system ? [safeModel.meta.system] : [],
      excelSystems: safeModel?.meta?.system ? [safeModel.meta.system] : [],
      createdAt: safeModel?.meta?.createdAt,
    },
    jobType: safeModel?.meta?.jobType || 'montage',
    jobFactor: Number(safeModel?.meta?.jobFactor) || 1,
    materials: mapItems,
    labor: mapWorkers,
    laborTotals: mapWorkers,
    extraInputs: {
      km: kmQuantity,
      slaebePctInput: Number(extras?.slaeb?.percent) || 0,
      boringHuller: Number((extras?.extraWork || []).find(entry => entry.type === 'Boring af huller')?.quantity) || 0,
      boringBeton: Number((extras?.extraWork || []).find(entry => entry.type === 'Boring i beton')?.quantity) || 0,
      lukHuller: Number((extras?.extraWork || []).find(entry => entry.type === 'Lukning af huller')?.quantity) || 0,
      opskydeligt: Number((extras?.extraWork || []).find(entry => entry.type === 'Opskydeligt rækværk')?.quantity) || 0,
    },
    extras: {
      km: kmAmount,
      kmBelob: kmAmount,
      kmAntal: kmQuantity,
      slaebePct: Number(extras?.slaeb?.percent) || 0,
      slaebeBelob: Number(extras?.slaeb?.amount) || 0,
      tralleløft: Number(extras?.tralle?.amount) || 0,
    },
    totals: {
      materialer: Number(totals.materials) || 0,
      ekstraarbejde: Number(totals.extras) || 0,
      samletAkkordsum: Number(totals.akkord) || 0,
      projektsum: Number(totals.project) || Number(totals.akkord) || 0,
    },
    tralleState: {
      n35: Number(extras?.tralle?.lifts35) || 0,
      n50: Number(extras?.tralle?.lifts50) || 0,
    },
    tralleSum: Number(extras?.tralle?.amount) || 0,
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
