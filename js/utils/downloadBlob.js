export function downloadBlob(blob, filename) {
  if (!blob || typeof document === 'undefined') return;
  const safeName = typeof filename === 'string' && filename.trim() ? filename : 'download';
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeName;
  document.body.appendChild(link);

  const click = () => {
    if (typeof MouseEvent === 'function') {
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return;
    }
    if (typeof link.click === 'function') {
      link.click();
    }
  };
  click();

  const timer = typeof window !== 'undefined' && typeof window.setTimeout === 'function'
    ? window.setTimeout
    : setTimeout;

  timer(() => link.remove(), 750);
  timer(() => URL.revokeObjectURL(url), 1500);
}
