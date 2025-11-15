let exportLibsPromise = null
let zipLibPromise = null

const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.es.min.js'
const HTML2CANVAS_URL = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.esm.js'
const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.esm.min.js'

async function loadJsPDF () {
  const mod = await import(JSPDF_URL)
  if (mod?.jsPDF) return mod.jsPDF
  if (mod?.default?.jsPDF) return mod.default.jsPDF
  return mod?.default || mod
}

async function loadHtml2Canvas () {
  const mod = await import(HTML2CANVAS_URL)
  return mod?.default || mod?.html2canvas || mod
}

async function loadJSZip () {
  const mod = await import(JSZIP_URL)
  return mod?.default || mod
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
