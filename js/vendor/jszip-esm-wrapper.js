import './jszip.min.js'

const JSZip = globalThis.JSZip || (typeof window !== 'undefined' ? window.JSZip : undefined)

export { JSZip }
export default JSZip
