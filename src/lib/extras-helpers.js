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

export function resolveKmBelob(extras = {}, kmRate = DEFAULT_KM_RATE) {
  if (!extras || typeof extras !== 'object') return 0;

  const providedKmBelob = Number(extras.kmBelob ?? extras.kilometer);
  if (Number.isFinite(providedKmBelob) && providedKmBelob >= 0) {
    return providedKmBelob;
  }

  const kmAntal = Number(resolveKmInputValue(extras, kmRate));
  if (Number.isFinite(kmAntal) && kmAntal >= 0 && Number.isFinite(kmRate) && kmRate > 0) {
    return kmAntal * kmRate;
  }

  return 0;
}
