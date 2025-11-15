const scriptPromises = new Map();

function loadScript(src) {
  if (typeof document === 'undefined') {
    return Promise.resolve();
  }
  if (scriptPromises.has(src)) {
    return scriptPromises.get(src);
  }
  const existing = Array.from(document.querySelectorAll('script')).find(el => el.src && el.src.endsWith(src.replace(/^\.\//, '')));
  if (existing) {
    const promise = new Promise((resolve, reject) => {
      if (existing.dataset.loaded === 'true') {
        resolve();
      } else {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', event => reject(event?.error || new Error(`Kunne ikke indlæse ${src}`)), { once: true });
      }
    });
    scriptPromises.set(src, promise);
    return promise;
  }

  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.inlineSrc = src;
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    }, { once: true });
    script.addEventListener('error', event => {
      reject(event?.error || new Error(`Kunne ikke indlæse ${src}`));
    }, { once: true });
    document.head.appendChild(script);
  });

  scriptPromises.set(src, promise);
  return promise;
}

let exportLibPromise = null;
let zipLibPromise = null;
let excelLibPromise = null;

export async function ensureExportLibs() {
  if (exportLibPromise) return exportLibPromise;
  exportLibPromise = (async () => {
    if (typeof window === 'undefined') {
      return { jsPDF: null, html2canvas: null };
    }
    if (window.jspdf?.jsPDF && window.html2canvas) {
      return { jsPDF: window.jspdf.jsPDF, html2canvas: window.html2canvas };
    }
    await Promise.all([
      loadScript('./src/features/export/vendors/html2canvas.min.js'),
      loadScript('./src/features/export/vendors/jspdf.umd.min.js'),
    ]);
    const jsPDF = window.jspdf?.jsPDF || window.jsPDF;
    const html2canvas = window.html2canvas;
    if (!jsPDF || !html2canvas) {
      throw new Error('Eksportbiblioteker kunne ikke indlæses');
    }
    return { jsPDF, html2canvas };
  })();
  return exportLibPromise;
}

export async function ensureZipLib() {
  if (zipLibPromise) return zipLibPromise;
  zipLibPromise = (async () => {
    if (typeof window === 'undefined') {
      return { JSZip: null };
    }
    if (window.JSZip) {
      return { JSZip: window.JSZip };
    }
    await loadScript('./src/features/export/vendors/jszip.min.js');
    if (!window.JSZip) {
      throw new Error('JSZip kunne ikke indlæses');
    }
    return { JSZip: window.JSZip };
  })();
  return zipLibPromise;
}

export async function ensureExcelLib() {
  if (excelLibPromise) return excelLibPromise;
  excelLibPromise = (async () => {
    if (typeof window === 'undefined') {
      return { XLSX: null };
    }
    if (window.XLSX?.utils) {
      return { XLSX: window.XLSX };
    }
    await loadScript('./src/features/export/vendors/xlsx.full.min.js');
    if (!window.XLSX?.utils) {
      throw new Error('XLSX bibliotek kunne ikke indlæses');
    }
    return { XLSX: window.XLSX };
  })();
  return excelLibPromise;
}

export async function prefetchExportLibs() {
  try {
    await Promise.all([
      ensureExportLibs(),
      ensureZipLib(),
      ensureExcelLib(),
    ]);
  } catch (error) {
    console.warn('Kunne ikke for-indlæse eksportbiblioteker', error);
  }
}
