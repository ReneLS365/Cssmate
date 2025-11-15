import { evaluateExpression } from './safe-eval.js'

// js/numpad.js
// Globalt numpad + simpel lommeregner til alle talfelter

const NUMPAD_SELECTOR = 'input[type="number"], input[data-numpad="true"], input[data-a9-slaeb="true"]'

let overlay, displayExpr, displayCurrent
let commitBtn, closeBtn
let activeInput = null
let currentValue = '0'
let expression = ''
let mutationObserver = null
let pendingBind = false
const boundInputs = new WeakSet()

function initNumpad () {
  overlay = document.getElementById('numpad-overlay')
  if (!overlay) return

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
      hideNumpad(false)
    }
  })

  commitBtn.addEventListener('click', () => hideNumpad(true))
  closeBtn.addEventListener('click', () => hideNumpad(false))

  bindInputs()
  observeNumpadInputs()
}

function handleNumpadFocus (event) {
  const input = event.currentTarget
  if (!(input instanceof HTMLInputElement)) return

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
      attributeFilter: ['data-numpad', 'data-a9-slaeb', 'type']
    })
  }
}

function showNumpadForInput (input) {
  activeInput = input

  const initial = normalizeFromField(input.value)
  currentValue = initial === '' ? '0' : initial
  expression = ''

  updateDisplays()

  overlay.classList.remove('numpad-hidden')
  overlay.setAttribute('aria-hidden', 'false')
  if (document?.documentElement) {
    document.documentElement.classList.add('np-open')
  }
}

function hideNumpad (commit) {
  if (commit && activeInput) {
    const fieldValue = formatForField(currentValue)

    // Sæt værdi med komma-decimal
    activeInput.value = fieldValue

    // Fyr normalt input-event så eksisterende logik (materialer/løn osv.) kører
    const inputEvent = new Event('input', { bubbles: true })
    activeInput.dispatchEvent(inputEvent)

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
}

/* Tast-logic */

function handleKey (key) {
  switch (key) {
    case 'C':
      currentValue = '0'
      expression = ''
      break
    case 'BACK':
      if (currentValue.length > 1) {
        currentValue = currentValue.slice(0, -1)
      } else {
        currentValue = '0'
      }
      break
    case '%': {
      const base = parseFloat(currentValue || '0')
      if (Number.isFinite(base)) {
        currentValue = String(base / 100)
      }
      break
    }
    case '+':
    case '-':
    case '×':
    case '÷':
      addCurrentToExpression(key)
      currentValue = '0'
      break
    case '=':
      computeExpression()
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

function addCurrentToExpression (op) {
  const val = currentValue === '' ? '0' : currentValue
  if (!expression) {
    expression = val + ' ' + op + ' '
  } else {
    expression = expression + val + ' ' + op + ' '
  }
}

function computeExpression () {
  const expr = (expression + (currentValue || '0')).trim()
  if (!expr) return

  try {
    const result = evaluateExpression(expr)
    if (!Number.isFinite(result)) {
      throw new Error('Expression result is not finite')
    }
    currentValue = String(result)
    expression = ''
  } catch (error) {
    console.warn('Invalid expression in numpad:', error)
  }
}

/* Display */

function updateDisplays () {
  if (!displayCurrent) return
  displayExpr.textContent = expression.replace(/\./g, ',')
  displayCurrent.textContent = formatNumber(currentValue)
}

function formatNumber (v) {
  if (v === '' || v === null || v === undefined) return '0'
  const n = Number(v)
  if (!Number.isFinite(n)) return '0'
  // simpelt dansk-komma format
  return String(n).replace('.', ',')
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
