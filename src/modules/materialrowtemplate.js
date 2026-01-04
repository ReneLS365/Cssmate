/**
 * @purpose Provide a reusable renderer for materials rows with consistent markup.
 * @inputs item {id, name, price, quantity, manual, systemKey}
 *          options {admin, toNumber, formatCurrency, systemLabelMap}
 * @outputs {row, nameInput, qtyInput, priceInput, sumElement}
 */
export function createMaterialRow (item, {
  admin = false,
  toNumber = value => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0
    if (value == null) return 0
    const str = String(value).trim().replace(/\s+/g, '').replace(',', '.')
    const parsed = Number.parseFloat(str)
    return Number.isFinite(parsed) ? parsed : 0
  },
  formatCurrency = value => {
    const number = Number.isFinite(value) ? value : 0
    return new Intl.NumberFormat('da-DK', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(number)
  },
  systemLabelMap
} = {}) {
  if (!item || !item.id) {
    throw new Error('Item with valid id is required')
  }

  // LAYOUT-LOCK: HTML-struktur og rækkefølge af kolonner i materialerækker
  // må IKKE ændres uden samtidig at opdatere relevante tests.
  const row = document.createElement('div')
  row.className = `material-row mat-row csm-row${item.manual ? ' manual' : ''}`
  row.dataset.itemId = item.id
  if (item.systemKey) {
    row.dataset.system = item.systemKey
  }

  const sanitizedId = String(item.id).replace(/[^a-zA-Z0-9_-]+/g, '-')
  const qtyInputId = `qty-${sanitizedId}`

  // Name:
  // - Manual rækker skal være redigerbare (input)
  // - Standard rækker skal kunne wrappe navnet (div), så vi undgår "forkortelser" og horisontal scrolling.
  const baseName = item.name || ''
  const isManual = Boolean(item.manual)
  const nameInput = isManual ? document.createElement('input') : document.createElement('div')
  nameInput.className = `csm-name mat-name material-name col-name${isManual ? ' manual-name' : ''}`
  nameInput.dataset.id = item.id
  nameInput.setAttribute('aria-label', 'Materialenavn')

  if (isManual) {
    nameInput.type = 'text'
    nameInput.placeholder = 'Materiale'
    nameInput.value = baseName
  } else {
    const systemLabel = item.systemKey ? (systemLabelMap?.get(item.systemKey) || item.systemKey) : ''
    const displayName = systemLabel ? `${baseName} (${systemLabel})` : baseName
    nameInput.textContent = displayName
    nameInput.title = `Varenr. ${item.id}`
    nameInput.id = `name-${sanitizedId}`
    nameInput.setAttribute('aria-readonly', 'true')
  }

  const qtyInput = document.createElement('input')
  qtyInput.type = 'number'
  qtyInput.className = 'csm-qty qty mat-qty material-qty col-qty'
  qtyInput.dataset.id = item.id
  qtyInput.id = qtyInputId
  qtyInput.name = `qty[${item.id}]`
  qtyInput.inputMode = 'decimal'
  qtyInput.autocomplete = 'off'
  qtyInput.step = '0.01'
  qtyInput.dataset.numpad = 'true'
  qtyInput.dataset.numpadField = qtyInputId
  qtyInput.setAttribute('data-numpad-field', qtyInputId)
  qtyInput.placeholder = '0'
  qtyInput.setAttribute('aria-label', 'Antal')
  const qtyValue = item.quantity != null && item.quantity !== '' ? toNumber(item.quantity) : 0
  qtyInput.value = item.manual && qtyValue === 0 ? '' : String(qtyValue)

  const priceInput = document.createElement('input')
  priceInput.type = 'number'
  priceInput.className = 'csm-price price mat-price material-price col-price'
  priceInput.dataset.id = item.id
  priceInput.id = `price-${sanitizedId}`
  priceInput.name = `price[${item.id}]`
  priceInput.inputMode = 'decimal'
  priceInput.autocomplete = 'off'
  priceInput.step = '0.01'
  priceInput.dataset.numpad = 'true'
  priceInput.dataset.numpadField = `price-${sanitizedId}`
  priceInput.setAttribute('data-numpad-field', `price-${sanitizedId}`)
  priceInput.setAttribute('aria-label', 'Enhedspris')
  const hasPrice = item.price !== null && item.price !== undefined && item.price !== ''
  const priceValue = hasPrice ? toNumber(item.price) : 0
  priceInput.dataset.price = hasPrice ? String(priceValue) : ''
  if (item.manual) {
    priceInput.placeholder = 'Enhedspris'
    priceInput.readOnly = false
    priceInput.value = hasPrice ? String(priceValue) : ''
  } else {
    priceInput.dataset.requiresAdmin = 'true'
    const displayPrice = Number.isFinite(priceValue) ? priceValue.toFixed(2) : '0.00'
    priceInput.readOnly = !admin
    priceInput.value = displayPrice
  }

  const sumElement = document.createElement('div')
  sumElement.className = 'csm-sum mat-line mat-sum material-total col-total'
  sumElement.setAttribute('data-sum', '')
  sumElement.setAttribute('aria-label', 'Linjetotal')
  const lineTotal = toNumber(item.price) * toNumber(item.quantity)
  sumElement.textContent = `${formatCurrency(lineTotal)} kr`

  row.appendChild(nameInput)
  row.appendChild(qtyInput)
  row.appendChild(priceInput)
  row.appendChild(sumElement)

  const hasQty = toNumber(qtyInput.value) > 0
  row.toggleAttribute('data-has-qty', hasQty)
  row.dataset.hasQty = hasQty ? 'true' : 'false'

  return { row, nameInput, qtyInput, priceInput, sumElement }
}

export function attachRowHandlers (row, {
  toNumber = value => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0
    if (value == null) return 0
    const str = String(value).trim().replace(/\s+/g, '').replace(',', '.')
    const parsed = Number.parseFloat(str)
    return Number.isFinite(parsed) ? parsed : 0
  },
  formatCurrency = value => {
    const number = Number.isFinite(value) ? value : 0
    return new Intl.NumberFormat('da-DK', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(number)
  },
  onTotalsChange = () => {}
} = {}) {
  if (!row) return () => {}
  const qty = row.querySelector('input.csm-qty')
  const price = row.querySelector('input.csm-price')
  const sum = row.querySelector('[data-sum]')
  if (!qty || !price || !sum) return () => {}

  const update = () => {
    const quantity = toNumber(qty.value || 0)
    const unitPrice = toNumber(price.value || 0)
    const total = quantity * unitPrice
    sum.textContent = `${formatCurrency(total)} kr`
    const hasQty = quantity > 0
    row.toggleAttribute('data-has-qty', hasQty)
    row.dataset.hasQty = hasQty ? 'true' : 'false'
    onTotalsChange(total)
  }

  qty.addEventListener('input', update)
  price.addEventListener('input', update)

  return () => {
    qty.removeEventListener('input', update)
    price.removeEventListener('input', update)
  }
}
