import { normalizeKey } from '../string-utils.js';

const EXCLUDED_MATERIAL_NAMES = [
  'udd. tillæg 1',
  'udd. tillæg 2',
  'mentortillæg',
  'km.',
  'kilometer',
  'huller',
  'luk af hul',
  'boring i beton',
];

export const EXCLUDED_MATERIAL_KEYS = EXCLUDED_MATERIAL_NAMES
  .map(name => normalizeKey(name))
  .filter(Boolean);

export function shouldExcludeMaterialEntry(entry) {
  if (!entry) return false;
  const raw = entry.beskrivelse ?? entry.navn ?? entry.name ?? '';
  const key = normalizeKey(String(raw).trim());
  if (!key) return false;
  return EXCLUDED_MATERIAL_KEYS.includes(key);
}
