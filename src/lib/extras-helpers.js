export const DEFAULT_KM_RATE = 2.12;

export function resolveKmInputValue(extras = {}, kmRate = DEFAULT_KM_RATE) {
  if (!extras || typeof extras !== 'object') return '';
  const kmAntal = Number(extras.kmAntal);
  if (Number.isFinite(kmAntal) && kmAntal >= 0) return kmAntal;

  const kmBelob = Number(extras.kmBelob);
  if (Number.isFinite(kmBelob) && kmBelob >= 0 && Number.isFinite(kmRate) && kmRate > 0) {
    return kmBelob / kmRate;
  }

  const kmAmount = Number(extras.km);
  if (Number.isFinite(kmAmount)) {
    if (!extras.kmIsAmount && !('kmBelob' in extras)) {
      return kmAmount;
    }

    if (Number.isFinite(kmRate) && kmRate > 0) {
      return kmAmount / kmRate;
    }
  }

  return '';
}

export function mergeExtrasKm(extras = {}, extraInputs = {}, kmRate = DEFAULT_KM_RATE) {
  const merged = { ...(extras || {}) };
  const kmFromInputs = Number(extraInputs?.km);
  if (Number.isFinite(kmFromInputs)) {
    if (!Number.isFinite(merged.kmAntal)) merged.kmAntal = kmFromInputs;
    if (!Number.isFinite(merged.kmBelob) && Number.isFinite(kmRate)) {
      merged.kmBelob = kmFromInputs * kmRate;
    }
  }

  if (!Number.isFinite(merged.kmBelob) && merged.kmIsAmount && Number.isFinite(merged.km)) {
    merged.kmBelob = merged.km;
  }

  if (Number.isFinite(merged.kmAntal) && !Number.isFinite(merged.kmBelob) && Number.isFinite(kmRate)) {
    merged.kmBelob = merged.kmAntal * kmRate;
  }

  if (Number.isFinite(merged.kmBelob) && !('kmIsAmount' in merged)) {
    merged.kmIsAmount = true;
  }

  return merged;
}
