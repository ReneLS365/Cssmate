let exportLibsPromise = null
let zipLibPromise = null

const JSPDF_LOCAL_URL = '/js/vendor/jspdf.es.min.js'
const JSPDF_CDN_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.es.min.js'

const HTML2CANVAS_LOCAL_URL = '/js/vendor/html2canvas.esm.js'
const HTML2CANVAS_CDN_URL = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.esm.js'

const JSZIP_LOCAL_URL = '/js/vendor/jszip.esm.min.js'
const JSZIP_CDN_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'

async function loadWithFallback (sources, resolver, label) {
  let lastError = null
  for (const source of sources) {
    try {
      const mod = await import(source)
      return resolver(mod)
    } catch (error) {
      lastError = error
      console.warn(`Kunne ikke indlæse ${label} fra ${source}`, error)
    }
  }
  if (lastError) throw lastError
  throw new Error(`Kunne ikke indlæse ${label}`)
}

async function loadJsPDF () {
  return loadWithFallback(
    [JSPDF_LOCAL_URL, JSPDF_CDN_URL],
    mod => mod?.jsPDF || mod?.default?.jsPDF || mod?.default || mod,
    'jsPDF'
  )
}

async function loadHtml2Canvas () {
  return loadWithFallback(
    [HTML2CANVAS_LOCAL_URL, HTML2CANVAS_CDN_URL],
    mod => mod?.default || mod?.html2canvas || mod,
    'html2canvas'
  )
}

async function loadJSZip () {
  return loadWithFallback(
    [JSZIP_LOCAL_URL, JSZIP_CDN_URL],
    mod => mod?.JSZip || mod?.default?.JSZip || mod?.default || mod || globalThis.JSZip,
    'JSZip'
  )
}

export async function ensureExportLibs () {
  if (!exportLibsPromise) {
    exportLibsPromise = (async () => {
      const [jsPDF, html2canvas] = await Promise.all([loadJsPDF(), loadHtml2Canvas()])
      if (!jsPDF || !html2canvas) {
        throw new Error('Kunne ikke indlæse eksportbibliotekerne')
      }
      return { jsPDF, html2canvas }
    })()
  }
  return exportLibsPromise
}

export async function ensureZipLib () {
  if (!zipLibPromise) {
    zipLibPromise = (async () => {
      const JSZip = await loadJSZip()
      if (!JSZip) throw new Error('Kunne ikke indlæse JSZip')
      return { JSZip }
    })()
  }
  return zipLibPromise
}

export async function prefetchExportLibs () {
  try {
    await Promise.all([ensureExportLibs(), ensureZipLib()])
  } catch (error) {
    console.warn('Forudindlæsning af eksportlibs mislykkedes', error)
  }
}
