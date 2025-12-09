import { ensureExportLibs } from '../src/features/export/lazy-libs.js';
import { buildExportModel, formatDkk } from './export-model.js';

const PAGE_MARGIN = 20;
const LINE_HEIGHT = 5;
const SECTION_GAP = 4;
const BOX_PADDING = 3;
const FONT_SIZE_BASE = 10;
const FONT_SIZE_HEADER = 12;
const FONT_SIZE_TITLE = 18;
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
    const usableWidth = pageWidth - PAGE_MARGIN * 2;
    let y = PAGE_MARGIN;

    const ensureSpace = (height = LINE_HEIGHT) => {
      if (y + height > pageHeight - PAGE_MARGIN) {
        doc.addPage();
        y = PAGE_MARGIN;
      }
    };

    const addSectionTitle = (title) => {
      ensureSpace(LINE_HEIGHT * 2);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(FONT_SIZE_HEADER);
      doc.text(title, PAGE_MARGIN, y);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(FONT_SIZE_BASE);
      y += LINE_HEIGHT + SECTION_GAP;
    };

    const addKeyValueRows = (entries) => {
      if (!Array.isArray(entries) || entries.length === 0) return;
      const labelWidth = 40;
      entries.forEach(entry => {
        const value = entry?.value ?? '-';
        const label = entry?.label ?? '';
        const textLines = doc.splitTextToSize(String(value), usableWidth - labelWidth);
        const rowHeight = Math.max(LINE_HEIGHT, textLines.length * LINE_HEIGHT);
        ensureSpace(rowHeight + SECTION_GAP);
        doc.setFont('helvetica', 'bold');
        doc.text(`${label}:`, PAGE_MARGIN, y);
        doc.setFont('helvetica', 'normal');
        textLines.forEach((line, index) => {
          doc.text(line, PAGE_MARGIN + labelWidth, y + index * LINE_HEIGHT);
        });
        y += rowHeight;
      });
      y += SECTION_GAP;
    };

    const drawTableRow = (columns, linesPerCell, rowTop, rowHeight, isHeader = false) => {
      let cursorX = PAGE_MARGIN;
      columns.forEach((col, cellIndex) => {
        const lines = linesPerCell[cellIndex] || [''];
        doc.rect(cursorX, rowTop, col.width, rowHeight);
        const textX = col.align === 'right' ? cursorX + col.width - 2 : cursorX + BOX_PADDING;
        doc.setFont('helvetica', isHeader ? 'bold' : 'normal');
        lines.forEach((line, lineIndex) => {
          const textY = rowTop + BOX_PADDING + lineIndex * LINE_HEIGHT;
          const align = col.align === 'right' ? 'right' : 'left';
          doc.text(line, textX, textY, { align });
        });
        cursorX += col.width;
      });
    };

    const addTable = (title, columns, rows) => {
      addSectionTitle(title);
      if (!rows || rows.length === 0) {
        ensureSpace(LINE_HEIGHT);
        doc.text('Ingen data', PAGE_MARGIN, y);
        y += LINE_HEIGHT;
        return;
      }

      const headerLines = columns.map(col => [col.label]);
      const headerHeight = Math.max(...headerLines.map(lines => lines.length)) * LINE_HEIGHT + BOX_PADDING;
      ensureSpace(headerHeight + 2);
      drawTableRow(columns, headerLines, y, headerHeight, true);
      y += headerHeight;

      rows.forEach(row => {
        const cellLines = columns.map(col => {
          const rawValue = typeof col.value === 'function' ? col.value(row) : row[col.key];
          const asText = rawValue != null ? String(rawValue) : '';
          return doc.splitTextToSize(asText || '', col.width - 4);
        });
        const rowHeight = Math.max(...cellLines.map(lines => lines.length || 1)) * LINE_HEIGHT + BOX_PADDING;
        ensureSpace(rowHeight + 2);
        drawTableRow(columns, cellLines, y, rowHeight, false);
        y += rowHeight;
      });
      y += SECTION_GAP;
    };

    const addSubTitle = (title, offsetY = 0) => {
      ensureSpace(LINE_HEIGHT * 2 + offsetY);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(FONT_SIZE_HEADER);
      doc.text(title, PAGE_MARGIN, y + offsetY);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(FONT_SIZE_BASE);
      y += LINE_HEIGHT + SECTION_GAP;
    };

    doc.setFontSize(FONT_SIZE_TITLE);
    doc.setFont('helvetica', 'bold');
    doc.text('Akkordseddel', PAGE_MARGIN, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT_SIZE_BASE);
    y += LINE_HEIGHT * 2;

    const workerNamesList = Array.isArray(model?.wage?.workers)
      ? model.wage.workers.map(w => w.name).filter(Boolean)
      : [];
    const workerNames = (info.montoer || workerNamesList.join(', ') || '').trim();
    addSectionTitle('Sagsinfo');
    addKeyValueRows([
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
      { key: 'id', label: 'Id', width: 18 },
      { key: 'name', label: 'Materiale', width: 86 },
      { key: 'quantity', label: 'Antal', width: 18, align: 'right' },
      { key: 'price', label: 'Pris', width: 24, align: 'right' },
      { key: 'total', label: 'Linesum', width: 24, align: 'right' },
    ], materialRows);

    const workers = Array.isArray(model?.wage?.workers) ? model.wage.workers : [];
    const workerRows = workers.map(worker => ({
      type: worker.type || worker.name || '-',
      hours: formatNumber(worker.hours || 0),
      rate: formatCurrency(worker.rate || 0),
      total: formatCurrency(worker.total || 0),
    }));

    addTable('Løn', [
      { key: 'type', label: 'Arbejdstype', width: 86 },
      { key: 'hours', label: 'Timer', width: 20, align: 'right' },
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
    const extraWorkEntries = Array.isArray(extras?.extraWork) ? extras.extraWork : [];
    const extraWorkSum = extraWorkEntries.reduce((sum, entry) => sum + toNumber(entry.amount), 0) || toNumber(breakdown.extraWork ?? 0);
    const hoursTotal = toNumber(wageTotals.hours);
    const wageSum = toNumber(wageTotals.sum);
    const timePrice = hoursTotal > 0 ? akkordSum / hoursTotal : 0;

    const workerCount = workers.length;

    const findExtraAmount = (match) => {
      const found = extraWorkEntries.find(entry => (entry.type || '').toLowerCase().includes(match));
      return found ? toNumber(found.amount) : 0;
    };

    const holesAmount = findExtraAmount('boring af huller') || findExtraAmount('huller');
    const sealAmount = findExtraAmount('luk');
    const concreteAmount = findExtraAmount('beton');
    const otherExtra = Math.max(0, extraWorkSum - holesAmount - sealAmount - concreteAmount);
    const allowanceAmount = otherExtra + slaebAmount;

    const overviewEntries = [
      { label: 'Materialesum', value: formatCurrency(materialSum) },
      { label: 'Løn', value: formatCurrency(wageSum) },
      { label: 'Kilometer', value: `${formatCurrency(kmAmount)} (${formatNumber(kmQuantity)} km)` },
      { label: 'Tillæg', value: formatCurrency(allowanceAmount) },
      { label: 'Huller', value: formatCurrency(holesAmount) },
      { label: 'Luk af huller', value: formatCurrency(sealAmount) },
      { label: 'Boring i beton', value: formatCurrency(concreteAmount) },
      { label: 'Trailerløft', value: formatCurrency(tralleAmount) },
      { label: 'Samlet akkordsum', value: formatCurrency(akkordSum) },
      { label: 'Timer i alt', value: `${formatNumber(hoursTotal)} timer` },
      { label: 'Arbejdere i alt', value: workerCount },
    ];

    const overviewWidth = usableWidth * 0.55;
    const boxAreaX = PAGE_MARGIN + overviewWidth + BOX_PADDING;
    const savedY = y;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT_SIZE_HEADER);
    doc.text('Oversigt', PAGE_MARGIN, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT_SIZE_BASE);
    y += LINE_HEIGHT + SECTION_GAP;

    overviewEntries.forEach(entry => {
      ensureSpace(LINE_HEIGHT + SECTION_GAP);
      doc.text(`${entry.label}:`, PAGE_MARGIN, y);
      const valueX = PAGE_MARGIN + overviewWidth - BOX_PADDING;
      doc.text(String(entry.value), valueX, y, { align: 'right' });
      y += LINE_HEIGHT;
    });

    let boxY = savedY;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT_SIZE_HEADER);
    doc.text('Løn & projektsum', boxAreaX, boxY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT_SIZE_BASE);
    boxY += LINE_HEIGHT + SECTION_GAP;

    const boxWidth = usableWidth - overviewWidth - BOX_PADDING;
    const boxHeight = LINE_HEIGHT * 3 + BOX_PADDING;
    const boxEntries = [
      { label: 'Lønsum', value: formatCurrency(wageSum) },
      { label: 'Projektsum', value: formatCurrency(projectSum) },
    ];

    boxEntries.forEach((entry, index) => {
      ensureSpace(boxHeight + SECTION_GAP);
      const currentY = boxY + index * (boxHeight + SECTION_GAP);
      doc.rect(boxAreaX, currentY, boxWidth, boxHeight);
      doc.setFont('helvetica', 'bold');
      doc.text(entry.label, boxAreaX + BOX_PADDING, currentY + LINE_HEIGHT);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(FONT_SIZE_HEADER);
      doc.text(entry.value, boxAreaX + BOX_PADDING, currentY + LINE_HEIGHT * 2.4);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(FONT_SIZE_BASE);
    });

    y = Math.max(y, boxY + boxEntries.length * (boxHeight + SECTION_GAP));
    y += SECTION_GAP;

    addSectionTitle('Detaljer');
    addSubTitle('Sagsinfo', 0);
    addKeyValueRows([
      { label: 'Sagsnummer', value: meta.caseNumber || '-' },
      { label: 'Navn/opgave', value: meta.caseName || '-' },
      { label: 'Dato', value: meta.date || '-' },
      { label: 'Kunde', value: meta.customer || '-' },
    ]);

    addSubTitle('Materialer brugt:');
    materialsSorted.forEach(item => {
      const quantity = toNumber(item.quantity ?? item.qty ?? item.amount);
      const unitPrice = toNumber(item.unitPrice ?? item.price ?? item.stkPris ?? item.ackUnitPrice);
      const lineTotal = toNumber(item.lineTotal ?? item.linjeBelob ?? quantity * unitPrice);
      const line = `${item.name || item.id || 'Materiale'}: ${formatNumber(quantity)} x ${formatCurrency(unitPrice)} = ${formatCurrency(lineTotal)}`;
      const lines = doc.splitTextToSize(line, usableWidth);
      lines.forEach(textLine => {
        ensureSpace(LINE_HEIGHT);
        doc.text(textLine, PAGE_MARGIN, y);
        y += LINE_HEIGHT;
      });
    });
    y += SECTION_GAP;

    addSubTitle('Arbejde:');
    if (workers.length === 0) {
      ensureSpace(LINE_HEIGHT);
      doc.text('Ingen registrerede montører', PAGE_MARGIN, y);
      y += LINE_HEIGHT + SECTION_GAP;
    } else {
      workers.forEach(worker => {
        const uddLabel = worker.allowances?.udd ? ` (${worker.allowances.udd})` : '';
        const label = `${worker.type || worker.name || 'Montør'}${uddLabel}: ${formatNumber(worker.hours || 0)} Timer. Sats: ${formatCurrency(worker.rate || 0)}. Total: ${formatCurrency(worker.total || 0)}`;
        const lines = doc.splitTextToSize(label, usableWidth);
        lines.forEach(textLine => {
          ensureSpace(LINE_HEIGHT);
          doc.text(textLine, PAGE_MARGIN, y);
          y += LINE_HEIGHT;
        });
      });
      y += SECTION_GAP;
    }

    addSubTitle('Materialeoversigt:');
    addKeyValueRows([
      { label: 'Materialesum', value: formatCurrency(materialSum) },
      { label: 'Samlet akkordsum (lønsum + materialer)', value: formatCurrency(wageSum + materialSum) },
      { label: 'Timer i alt', value: `${formatNumber(hoursTotal)} timer` },
      { label: 'Medarbejdere', value: workerCount || 0 },
    ]);

    addSubTitle('Øvrige omkostninger:');
    const otherCosts = [];
    if (kmQuantity || kmAmount) otherCosts.push(`Kilometer: ${formatNumber(kmQuantity)} x ${formatCurrency(kmAmount && kmQuantity ? kmAmount / kmQuantity : 0)} = ${formatCurrency(kmAmount)}`);
    if (allowanceAmount) otherCosts.push(`Tillæg: ${formatCurrency(allowanceAmount)}`);
    if (holesAmount) otherCosts.push(`Boring af huller: ${formatCurrency(holesAmount)}`);
    if (sealAmount) otherCosts.push(`Luk af huller: ${formatCurrency(sealAmount)}`);
    if (concreteAmount) otherCosts.push(`Boring i beton: ${formatCurrency(concreteAmount)}`);
    if (tralleAmount) otherCosts.push(`Trailerløft: ${formatCurrency(tralleAmount)}`);
    if (otherCosts.length === 0) otherCosts.push('Ingen øvrige omkostninger');
    otherCosts.forEach(entry => {
      const lines = doc.splitTextToSize(entry, usableWidth);
      lines.forEach(textLine => {
        ensureSpace(LINE_HEIGHT);
        doc.text(textLine, PAGE_MARGIN, y);
        y += LINE_HEIGHT;
      });
    });

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
