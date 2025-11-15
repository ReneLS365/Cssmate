// js/numpad.js
// Globalt numpad + simpel lommeregner til alle talfelter

let overlay, displayMem, displayExpr, displayCurrent
let commitBtn, closeBtn
let activeInput = null

let memoryValue = 0
let currentValue = '0'
let expression = ''

function initNumpad () {
  overlay = document.getElementById('numpad-overlay')
  if (!overlay) return

  displayMem = document.getElementById('numpad-display-memory')
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
}

function bindInputs () {
  // Alle talfelter: type="number" eller med data-numpad="true"
  const selector = 'input[type="number"]:not([data-numpad="off"]), input[data-numpad="true"]'
  const inputs = document.querySelectorAll(selector)

  inputs.forEach(input => {
    // Hint til mobil om at det er tal
    if (!input.hasAttribute('inputmode')) {
      input.setAttribute('inputmode', 'decimal')
    }

    input.addEventListener('focus', () => {
      // Fjern default 0 ved fokus
      if (input.value === '0' || input.value === '0,00') {
        input.value = ''
      }
      showNumpadForInput(input)
    })

    // Blokér browserens eget keyboard-input – vi styrer alt via numpad
    input.addEventListener('beforeinput', (evt) => {
      evt.preventDefault()
    })
  })
}

function showNumpadForInput (input) {
  activeInput = input

  const initial = normalizeFromField(input.value)
  currentValue = initial === '' ? '0' : initial
  expression = ''

  updateDisplays()

  overlay.classList.remove('numpad-hidden')
  overlay.setAttribute('aria-hidden', 'false')
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

  const safe = expr
    .replace(/×/g, '*')
    .replace(/÷/g, '/')

  try {
    const result = Function('"use strict"; return (' + safe + ')')()
    if (!Number.isFinite(result)) return
    currentValue = String(result)
    expression = ''
  } catch (e) {
    expression = ''
  }
}

/* Display */

function updateDisplays () {
  if (!displayCurrent) return
  displayMem.textContent = 'M: ' + formatNumber(memoryValue)
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
