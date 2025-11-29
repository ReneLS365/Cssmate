// Brug: const csv = buildAkkordCSV(buildAkkordData());
import { buildExportModel, formatCsvNumber } from './export-model.js';

const SEP = ';';
const BOM = '\ufeff';

function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes('"') || str.includes(SEP) || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatQty(value) {
  const num = Number(value);
  if (Number.isInteger(num)) return String(num);
  return formatCsvNumber(value);
}

export function buildAkkordCSV(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('buildAkkordCSV: data mangler eller er ugyldig');
  }

  const model = (data?.meta?.caseNumber && Array.isArray(data?.items))
    ? data
    : buildExportModel(data);
  const meta = model.meta || {};
  const totals = model.totals || {};
  const extras = model.extras || {};

  const sagsnr = meta.caseNumber || 'UKENDT';
  const lines = [];

  // 1) META-blok
  lines.push('#META;FELT;VÆRDI');
  lines.push(`#META;version;${csvEscape(meta.version || model.version || '2.0')}`);
  lines.push(`#META;sagsnummer;${csvEscape(sagsnr)}`);
  lines.push(`#META;kunde;${csvEscape(meta.customer || '')}`);
  lines.push(`#META;adresse;${csvEscape(meta.address || '')}`);
  lines.push(`#META;beskrivelse;${csvEscape(meta.caseName || '')}`);
  lines.push(`#META;dato;${csvEscape(meta.date || new Date().toISOString().slice(0, 10))}`);
  lines.push(`#META;system;${csvEscape(meta.system || '')}`);
  lines.push(`#META;jobType;${csvEscape(meta.jobType || '')}`);
  lines.push(`#META;totalMaterialer;${csvEscape(formatCsvNumber(totals.materials || 0))}`);
  lines.push(`#META;totalAkkord;${csvEscape(formatCsvNumber(totals.akkord || 0))}`);
  lines.push('');

  // 2) MATERIALER-blok
  lines.push('TYPE;SAG;LINJENR;SYSTEM;KATEGORI;VARENR;NAVN;ENHED;ANTAL;STK_PRIS;LINJE_BELOB');
  for (const row of model.items || []) {
    lines.push([
      'MATERIAL',
      csvEscape(sagsnr),
      csvEscape(row.lineNumber ?? ''),
      csvEscape(row.system || ''),
      csvEscape(row.category || ''),
      csvEscape(row.itemNumber || ''),
      csvEscape(row.name || ''),
      csvEscape(row.unit || ''),
      csvEscape(formatQty(row.quantity ?? 0)),
      csvEscape(formatCsvNumber(row.unitPrice ?? 0)),
      csvEscape(formatCsvNumber(row.lineTotal ?? 0)),
    ].join(SEP));
  }
  lines.push('');

  // 3) KM / SLÆB / EKSTRA-blok
  lines.push('TYPE;SAG;ART;ANTAL;ENHED;SATS;BELOB;BESKRIVELSE');

  if (extras.km?.quantity || extras.km?.amount) {
    lines.push([
      'KM',
      csvEscape(sagsnr),
      'Transport km',
      csvEscape(formatQty(extras.km.quantity || 0)),
      'km',
      csvEscape(formatCsvNumber(extras.km.rate || 0)),
      csvEscape(formatCsvNumber(extras.km.amount || 0)),
      'Transporttillæg (km)',
    ].join(SEP));
  }

  if (extras.slaeb?.percent || extras.slaeb?.amount) {
    lines.push([
      'SLAEB',
      csvEscape(sagsnr),
      'Slæb (%)',
      csvEscape(formatCsvNumber(extras.slaeb.percent || 0)),
      '%',
      '',
      csvEscape(formatCsvNumber(extras.slaeb.amount || 0)),
      'Slæbt materiale (procenttillæg)',
    ].join(SEP));
  }

  if (extras.tralle?.amount) {
    lines.push([
      'TRALLE',
      csvEscape(sagsnr),
      'Tralleløft',
      csvEscape(formatQty((extras.tralle.lifts35 || 0) + (extras.tralle.lifts50 || 0))),
      'løft',
      '',
      csvEscape(formatCsvNumber(extras.tralle.amount || 0)),
      'Tralleløft samlet',
    ].join(SEP));
  }

  for (const e of extras.extraWork || []) {
    lines.push([
      'EKSTRA',
      csvEscape(sagsnr),
      csvEscape(e.type || 'Ekstraarbejde'),
      csvEscape(formatQty(e.quantity ?? 0)),
      csvEscape(e.unit || ''),
      csvEscape(formatCsvNumber(e.rate || 0)),
      csvEscape(formatCsvNumber(e.amount || 0)),
      csvEscape(e.description || ''),
    ].join(SEP));
  }

  return BOM + lines.join('\n');
}
