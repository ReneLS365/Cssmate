let exportLibsPromise = null
let zipLibPromise = null

const JSPDF_CDN = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js'
const HTML2CANVAS_URL = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.esm.js'
const JSZIP_CDN = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'

const JSPDF_LOCAL = new URL('../../../js/vendor/jspdf-esm-wrapper.js', import.meta.url).href
const HTML2CANVAS_LOCAL = new URL('../../../js/vendor/html2canvas.esm.js', import.meta.url).href
const JSZIP_LOCAL = new URL('../../../js/vendor/jszip-esm-wrapper.js', import.meta.url).href

async function importWithFallback(primaryUrl, fallbackUrl) {
  const candidates = [primaryUrl, fallbackUrl].filter(Boolean)
  const sorted = typeof window === 'undefined'
    ? candidates.slice().sort((a, b) => {
        const aRemote = /^https?:/i.test(a)
        const bRemote = /^https?:/i.test(b)
        if (aRemote === bRemote) return 0
        return aRemote ? 1 : -1
      })
    : candidates

  let lastError = null
  for (const url of sorted) {
    try {
      return await import(url)
    } catch (error) {
      lastError = error
      console.warn(`Kunne ikke indlæse ${url}, prøver fallback`, error)
    }
  }
  throw lastError || new Error('Import mislykkedes uden fejlbesked')
}

async function loadJsPDF () {
  if (typeof self === 'undefined') globalThis.self = globalThis
  if (typeof navigator === 'undefined') globalThis.navigator = {}
  const mod = await importWithFallback(JSPDF_LOCAL, JSPDF_CDN)
  if (mod?.jsPDF) return mod.jsPDF
  if (mod?.default?.jsPDF) return mod.default.jsPDF
  return mod?.default || mod
}

async function loadHtml2Canvas () {
  const mod = await importWithFallback(HTML2CANVAS_LOCAL, HTML2CANVAS_URL)
  return mod?.default || mod?.html2canvas || mod
}

async function loadJSZip () {
  const mod = await importWithFallback(JSZIP_LOCAL, JSZIP_CDN)
  return mod?.JSZip || mod?.default || mod
}

export async function ensureExportLibs () {
  if (!exportLibsPromise) {
    exportLibsPromise = (async () => {
      const disableHtml2Canvas = typeof window === 'undefined' || window?.__CSSMATE_DISABLE_HTML2CANVAS
      const html2canvasLoader = disableHtml2Canvas
        ? async () => () => { throw new Error('html2canvas er ikke tilgængelig i dette miljø') }
        : loadHtml2Canvas
      const [jsPDF, html2canvas] = await Promise.all([loadJsPDF(), html2canvasLoader()])
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
