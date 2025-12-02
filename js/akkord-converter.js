export function convertMontageToDemontage(raw = {}) {
  const meta = {
    ...(raw.meta || {}),
    jobType: 'demontage',
    version: 1
  };

  const items = Array.isArray(raw.items) ? raw.items : [];
  const materials = items.map(item => ({
    id: item.itemNumber || item.id || '',
    name: item.name || item.label || item.title || '',
    qty: Number(item.quantity ?? item.qty ?? 0) || 0,
    unitPrice: Number(item.unitPrice ?? item.price ?? 0) || 0,
    system: item.system || raw.meta?.system || ''
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
