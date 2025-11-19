const SHEET_JS_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
let sheetJsPromise = null

function loadScript(url) {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('SheetJS kan kun indlæses i browseren.'))
      return
    }

    const existing = document.querySelector(`script[data-sheetjs="${url}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', reject)
      if (existing.hasAttribute('data-loaded')) {
        resolve()
      }
      return
    }

    const script = document.createElement('script')
    script.src = url
    script.async = true
    script.crossOrigin = 'anonymous'
    script.dataset.sheetjs = url
    script.addEventListener('load', () => {
      script.setAttribute('data-loaded', 'true')
      resolve()
    })
    script.addEventListener('error', reject)
    document.head.appendChild(script)
  })
}

export async function ensureSheetJs () {
  if (typeof window !== 'undefined' && window.XLSX) {
    return window.XLSX
  }

  if (!sheetJsPromise) {
    sheetJsPromise = loadScript(SHEET_JS_URL)
      .then(() => {
        if (typeof window === 'undefined' || !window.XLSX) {
          throw new Error('SheetJS kunne ikke indlæses korrekt.')
        }
        return window.XLSX
      })
      .catch(error => {
        sheetJsPromise = null
        throw error
      })
  }

  return sheetJsPromise
}
