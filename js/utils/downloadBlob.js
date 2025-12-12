export function downloadBlob(blob, filename) {
  if (!blob || typeof document === 'undefined') return;
  const safeName = typeof filename === 'string' && filename.trim() ? filename : 'download';
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  const timer = typeof window !== 'undefined' && typeof window.setTimeout === 'function'
    ? window.setTimeout
    : setTimeout;
  timer(() => URL.revokeObjectURL(url), 500);
}
