import './jspdf.umd.min.js'

const jsPDF = (globalThis.jspdf && globalThis.jspdf.jsPDF) || globalThis.jsPDF || (typeof window !== 'undefined' && window.jsPDF) || (typeof window !== 'undefined' && window.jspdf?.jsPDF)

export { jsPDF }
export default jsPDF
