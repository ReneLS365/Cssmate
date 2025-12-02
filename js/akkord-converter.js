export function convertMontageToDemontage(raw = {}) {
  const meta = {
    ...(raw.meta || {}),
    jobType: 'demontage',
    version: 1
  };

  const items = Array.isArray(raw.items) ? raw.items : [];
  const materials = items.map(item => ({
    id: item.itemNumber || item.id || item.varenr || '',
    name: item.name || item.label || item.title || '',
    qty: Number(item.quantity ?? item.qty ?? item.amount ?? item.antal ?? 0) || 0,
    unitPrice: Number(item.unitPrice ?? item.price ?? item.stkPris ?? 0) || 0,
    system: item.system || item.systemKey || item.systemId || raw.meta?.system || ''
  }));

  const extras = raw.extras || {};
  const wage = raw.wage || {};
  const totals = raw.totals || {};

  return {
    version: 1,
    jobType: 'demontage',
    meta,
    materials,
    extras,
    wage,
    totals
  };
}
