function toNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const normalized = trimmed
      .replace(/\s+/g, '')
      .replace(/'/g, '')
      .replace(/(?!^)-/g, '')
      .replace(/,(?=[^,]*,)/g, '')
      .replace(/,(?=[^,]*$)/, '.')
      .replace(/\.(?=.*\.)/g, '');
    const num = Number.parseFloat(normalized);
    return Number.isFinite(num) ? num : 0;
  }
  return 0;
}

function resolveMaterialSum(lines) {
  if (!Array.isArray(lines)) return 0;
  return lines.reduce((sum, line) => {
    if (!line) return sum;
    const qty = toNumber(line.qty ?? line.quantity);
    if (qty <= 0) return sum;
    const unitPrice = toNumber(line.unitPrice ?? line.price);
    return sum + qty * unitPrice;
  }, 0);
}

function resolveExtraSum(extra) {
  if (Array.isArray(extra)) {
    return extra.reduce((sum, value) => sum + resolveExtraSum(value), 0);
  }
  if (typeof extra === 'number') {
    return Number.isFinite(extra) ? extra : 0;
  }
  if (!extra || typeof extra !== 'object') {
    return 0;
  }
  return Object.values(extra).reduce((sum, value) => sum + resolveExtraSum(value), 0);
}

function resolveWorkerSum(workers) {
  if (!Array.isArray(workers)) return 0;
  return workers.reduce((sum, worker) => {
    if (!worker) return sum;
    const hours = toNumber(worker.hours);
    if (hours <= 0) return sum;
    const rate = toNumber(worker.hourlyWithAllowances ?? worker.rate ?? worker.hourlyRate);
    return sum + hours * rate;
  }, 0);
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateTotals(input = {}) {
  const materialSum = resolveMaterialSum(input.materialLines);
  const slaeb = round2(toNumber(input.slaebeBelob));
  const extraSum = round2(resolveExtraSum(input.extra));
  const samletAkkordsum = round2(materialSum + slaeb + extraSum);

  const totalHours = toNumber(input.totalHours);
  const timeprisUdenTillaeg = totalHours > 0
    ? round2(samletAkkordsum / totalHours)
    : 0;

  const laborSum = round2(resolveWorkerSum(input.workers));
  const projektsum = round2(samletAkkordsum + laborSum);

  return {
    materialer: round2(materialSum),
    slaeb,
    ekstraarbejde: extraSum,
    samletAkkordsum,
    timeprisUdenTillaeg,
    montoerLonMedTillaeg: laborSum,
    projektsum,
    totalHours,
  };
}
