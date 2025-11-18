// js/numpad.js
// Globalt numpad + simpel lommeregner til alle talfelter

const NUMPAD_SELECTOR = 'input[type="number"], input[data-numpad="true"]'

let overlay, dialog, displayExpr, displayCurrent
let commitBtn, closeBtn
let activeInput = null
let currentValue = '0'
let expression = ''
let mutationObserver = null
let pendingBind = false
const boundInputs = new WeakSet()
let lastFocusedInput = null
let baseValue = 0
let activeOperator = null
let suppressNextFocus = false

function isNumpadOpen () {
  return Boolean(overlay && !overlay.classList.contains('numpad-hidden'))
}

function initNumpad () {
  overlay = document.querySelector('[data-numpad-overlay]') || document.getElementById('numpad-overlay')
  if (!overlay) return

  dialog = overlay.querySelector('[data-numpad-dialog]') || overlay.querySelector('.numpad-panel')

  displayExpr = document.getElementById('numpad-display-expression')
  displayCurrent = document.getElementById('numpad-display-current')
  commitBtn = document.getElementById('numpad-btn-commit')
  closeBtn = document.getElementById('numpad-btn-close')

  overlay.addEventListener('click', (e) => {
    const keyEl = e.target.closest('.numpad-key')
    if (keyEl && keyEl.dataset.key) {
      handleKey(keyEl.dataset.key)
      e.stopPropagation()
      return
    }

    // Klik på mørk baggrund lukker uden commit
    if (e.target === overlay) {
      hideNumpad({ commit: false })
    }
  })

  if (commitBtn) {
    commitBtn.addEventListener('click', handleCommitClick)
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', () => hideNumpad({ commit: false }))
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && isNumpadOpen()) {
      event.preventDefault()
      hideNumpad({ commit: false })
    }
  })

  bindInputs()
  observeNumpadInputs()
}

function handleNumpadFocus (event) {
  const input = event.currentTarget
  if (!(input instanceof HTMLInputElement)) return
  if (suppressNextFocus) {
    suppressNextFocus = false
    return
  }

  const rawValue = (input.value || '').trim()
  const isZeroLike = rawValue === '' || rawValue === '0' || rawValue === '0,0' || rawValue === '0,00'

  if (isZeroLike) {
    input.value = ''
  }

  showNumpadForInput(input)
}

function blockNativeInput (event) {
  event.preventDefault()
}

function bindInputs () {
  const inputs = document.querySelectorAll(NUMPAD_SELECTOR)
  inputs.forEach(input => {
    if (!(input instanceof HTMLInputElement) || boundInputs.has(input)) return

    input.setAttribute('readonly', 'readonly')
    input.setAttribute('inputmode', 'none')
    input.classList.add('numpad-readonly')

    const wantsNumpad = input.dataset.numpad === 'true' || (input.type === 'number' && input.dataset.numpad !== 'off')

    if (wantsNumpad) {
      input.addEventListener('focus', handleNumpadFocus)
      input.addEventListener('beforeinput', blockNativeInput)
    }

    boundInputs.add(input)
  })
}

function scheduleBind () {
  if (pendingBind) return
  pendingBind = true
  const run = () => {
    pendingBind = false
    bindInputs()
  }
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(run)
  } else {
    setTimeout(run, 0)
  }
}

function observeNumpadInputs () {
  if (mutationObserver || typeof MutationObserver === 'undefined') {
    return
  }
  mutationObserver = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue
          if (node.matches(NUMPAD_SELECTOR) || node.querySelector(NUMPAD_SELECTOR)) {
            scheduleBind()
            return
          }
        }
      } else if (mutation.type === 'attributes') {
        const target = mutation.target
        if (target instanceof HTMLElement && target.matches(NUMPAD_SELECTOR)) {
          scheduleBind()
          return
        }
      }
    }
  })
  const target = document.body || document.documentElement
  if (target) {
    mutationObserver.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-numpad', 'type']
    })
  }
}

function showNumpadForInput (input) {
  if (!overlay) return

  activeInput = input instanceof HTMLInputElement ? input : null
  lastFocusedInput = activeInput

  const inputValue = activeInput && typeof activeInput.value === 'string' ? activeInput.value : ''
  const initial = normalizeFromField(inputValue)
  currentValue = initial === '' ? '0' : initial
  baseValue = parseNumericValue(currentValue)
  if (baseValue === null) baseValue = 0
  expression = ''
  activeOperator = null

  updateDisplays()

  overlay.classList.remove('numpad-hidden')
  overlay.setAttribute('aria-hidden', 'false')
  if (document?.documentElement) {
    document.documentElement.classList.add('np-open')
  }
  if (dialog && typeof dialog.focus === 'function') {
    dialog.focus()
  }
}

function hideNumpad ({ commit = false } = {}) {
  if (!overlay) return

  const focusTarget = lastFocusedInput

  if (commit && activeInput) {
    const fieldValue = formatForField(currentValue)

    // Sæt værdi med komma-decimal
    activeInput.value = fieldValue

    // Fyr normalt input-event så eksisterende logik (materialer/løn osv.) kører
    const inputEvent = new Event('input', { bubbles: true })
    activeInput.dispatchEvent(inputEvent)

    const changeEvent = new Event('change', { bubbles: true })
    activeInput.dispatchEvent(changeEvent)

    // Ekstra event hvis man vil fange det specifikt
    const customEvent = new CustomEvent('numpad-commit', {
      bubbles: true,
      detail: {
        value: fieldValue,
        numeric: Number(fieldValue.replace(',', '.')) || 0
      }
    })
    activeInput.dispatchEvent(customEvent)
  }

  overlay.classList.add('numpad-hidden')
  overlay.setAttribute('aria-hidden', 'true')
  activeInput = null
  if (document?.documentElement) {
    document.documentElement.classList.remove('np-open')
  }
  if (focusTarget && document.contains(focusTarget) && typeof focusTarget.focus === 'function') {
    suppressNextFocus = true
    focusTarget.focus()
    setTimeout(() => {
      suppressNextFocus = false
    }, 0)
  } else {
    suppressNextFocus = false
  }
  lastFocusedInput = null
}

function handleCommitClick () {
  const resolved = evaluatePendingExpression()
  const fallback = parseNumericValue(currentValue)
  const numericResult = resolved ?? fallback ?? baseValue ?? 0

  currentValue = String(numericResult)
  baseValue = numericResult
  activeOperator = null
  expression = ''

  updateDisplays()
  hideNumpad({ commit: true })
}

/* Tast-logic */

function handleKey (key) {
  switch (key) {
    case 'C':
      currentValue = '0'
      expression = ''
      baseValue = 0
      activeOperator = null
      break
    case 'BACK':
      if (currentValue.length > 1) {
        currentValue = currentValue.slice(0, -1)
      } else if (currentValue.length === 1) {
        currentValue = activeOperator ? '' : '0'
      } else {
        currentValue = ''
      }
      break
    case '%': {
      const numeric = parseNumericValue(currentValue)
      if (numeric !== null) {
        currentValue = String(numeric / 100)
      } else {
        currentValue = '0'
      }
      break
    }
    case '+':
    case '-':
    case '×':
    case '÷':
      handleOperatorInput(key)
      break
    case '=':
      applyPendingExpression()
      break
    case ',':
      if (!currentValue.includes('.')) {
        currentValue = currentValue + '.'
      }
      break
    default:
      // tal 0-9
      if (/^\d$/.test(key)) {
        if (currentValue === '0') currentValue = key
        else currentValue += key
      }
      break
  }
  updateDisplays()
}

function handleOperatorInput (op) {
  const hasOperator = Boolean(activeOperator)
  const operand = parseNumericValue(currentValue)

  if (hasOperator && operand !== null) {
    const interim = evaluatePendingExpression()
    if (interim !== null && interim !== undefined) {
      baseValue = interim
      currentValue = ''
    }
  } else if (!hasOperator && operand !== null) {
    baseValue = operand
    currentValue = ''
  } else if (!hasOperator && operand === null) {
    currentValue = ''
  }

  activeOperator = op
}

function applyPendingExpression () {
  const result = evaluatePendingExpression()
  if (result === null || result === undefined) return

  currentValue = String(result)
  baseValue = result
  activeOperator = null
  expression = ''
}

function evaluatePendingExpression () {
  const base = Number.isFinite(baseValue) ? baseValue : 0
  const operand = parseNumericValue(currentValue)

  if (!activeOperator) {
    return operand !== null ? operand : base
  }
  if (operand === null) {
    return base
  }

  switch (activeOperator) {
    case '+':
      return base + operand
    case '-':
      return base - operand
    case '×':
      return base * operand
    case '÷':
      return operand === 0 ? base : base / operand
    default:
      return base
  }
}

/* Display */

function updateDisplays () {
  if (!displayCurrent || !displayExpr) return
  expression = getExpressionText()
  displayExpr.textContent = expression
  displayCurrent.textContent = formatNumber(currentValue)
}

function getExpressionText () {
  if (!activeOperator) return ''
  const baseDisplay = formatNumber(baseValue)
  if (currentValue === '') {
    return `${baseDisplay} ${activeOperator}`
  }
  return `${baseDisplay} ${activeOperator} ${formatNumber(currentValue)}`
}

function formatNumber (v) {
  if (v === '' || v === null || v === undefined) return '0'
  const n = Number(v)
  if (!Number.isFinite(n)) return '0'
  // simpelt dansk-komma format
  return String(n).replace('.', ',')
}

function parseNumericValue (value) {
  if (value === null || value === undefined) return null
  const normalized = String(value).trim().replace(/,/g, '.').replace(/\s+/g, '')
  if (!normalized || normalized === '.' || normalized === '-' || normalized === '+') {
    return null
  }
  const numeric = Number(normalized)
  return Number.isFinite(numeric) ? numeric : null
}

function normalizeFromField (v) {
  if (!v) return ''
  return String(v)
    .replace(/\./g, ',')
    .replace(',', '.')
    .replace(/[^0-9.\-]/g, '')
}

function formatForField (v) {
  return formatNumber(v)
}

/* Public init */

export function setupNumpad () {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNumpad)
  } else {
    initNumpad()
  }
}
