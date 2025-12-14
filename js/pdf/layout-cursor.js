export const PAGE = { w: 595.28, h: 841.89 }
export const MARGIN = 36
export const HEADER_H = 18
export const FOOTER_H = 16

export const TOP_Y = PAGE.h - MARGIN - HEADER_H
export const BOTTOM_Y = MARGIN + FOOTER_H

export const H = {
  section: 22,
  tableHeader: 18,
  row: 18,
  rowWrap2: 30,
  groupRow: 18,
  gapSm: 8,
  gapMd: 12,
  summaryLine: 16,
  summaryAux: 12,
  summaryRule: 10,
}

export function createLayoutCursor(doc, { renderHeader } = {}) {
  let page = 1
  let y = TOP_Y

  const remaining = () => y - BOTTOM_Y

  const moveDown = (height) => {
    y -= height
    return y
  }

  const toPageY = (offset = 0) => PAGE.h - (y - offset)

  const newPage = () => {
    doc.addPage()
    page += 1
    y = TOP_Y
    if (typeof renderHeader === 'function') renderHeader(page)
  }

  const ensureSpace = (height, { withTableHeader } = {}) => {
    if (remaining() >= height) return false
    newPage()
    if (typeof withTableHeader === 'function') withTableHeader()
    return true
  }

  return {
    get page() { return page },
    get x() { return MARGIN },
    get y() { return y },
    remaining,
    ensureSpace,
    moveDown,
    newPage,
    toPageY,
  }
}
