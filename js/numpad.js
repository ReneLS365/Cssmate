// js/numpad.js
// Globalt numpad + simpel lommeregner til alle talfelter

const NUMPAD_SELECTOR = 'input[type="number"], input[data-numpad="true"]'

let overlay, dialog, displayExpr, displayCurrent
let commitBtn, closeBtn
let activeInput = null
let currentValue = '0'
let expression = ''
let mutationObserver = null
const boundInputs = new WeakSet()
let lastFocusedInput = null
let baseValue = 0
let activeOperator = null
let expressionParts = []
let suppressNextFocus = false
const NUMPAD_HIDE_DELAY = 180
let overlayHideTimer = null
const NUMPAD_ACTIVE_CLASS = 'numpad-target-active'
const NUMPAD_COMMIT_READY_CLASS = 'numpad-commit--ready'
const NUMPAD_COMMITTED_CLASS = 'numpad-committed'
let initialFieldValue = ''
let displayUpdateFrame = null

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

  overlay.addEventListener('pointerdown', handleOverlayPointerDown, { passive: false })

  if (commitBtn) {
    commitBtn.addEventListener('click', handleCommitClick)
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', () => hideNumpad({ commit: false }))
  }

  document.addEventListener('keydown', handleKeydown)

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

function handleNumpadPointerDown (event) {
  const input = event.currentTarget
  if (!(input instanceof HTMLInputElement)) return
  if (isNumpadOpen()) return
  if (document.activeElement !== input) return
  event.preventDefault()
  showNumpadForInput(input)
}

function handleOverlayPointerDown (event) {
  const keyEl = event.target.closest('.numpad-key')
  const isCommit = commitBtn && (event.target === commitBtn || commitBtn.contains(event.target))
  const isClose = closeBtn && (event.target === closeBtn || closeBtn.contains(event.target))

  if (keyEl && keyEl.dataset.key) {
    event.preventDefault()
    handleKey(keyEl.dataset.key)
    return
  }

  if (isCommit) {
    event.preventDefault()
    handleCommitClick()
    return
  }

  if (isClose) {
    event.preventDefault()
    hideNumpad({ commit: false })
    return
  }

  // Klik på mørk baggrund lukker uden commit
  if (event.target === overlay) {
    event.preventDefault()
    hideNumpad({ commit: false })
  }
}

function blockNativeInput (event) {
  event.preventDefault()
}

function bindInputElement (input) {
  if (!(input instanceof HTMLInputElement) || boundInputs.has(input)) return

  input.setAttribute('readonly', 'readonly')
  input.setAttribute('inputmode', 'none')
  input.classList.add('numpad-readonly')

  const wantsNumpad = input.dataset.numpad === 'true' || (input.type === 'number' && input.dataset.numpad !== 'off')

  if (wantsNumpad) {
    input.addEventListener('focus', handleNumpadFocus)
    input.addEventListener('pointerdown', handleNumpadPointerDown)
    input.addEventListener('beforeinput', blockNativeInput)
  }

  boundInputs.add(input)
}

function bindInputs () {
  const inputs = document.querySelectorAll(NUMPAD_SELECTOR)
  inputs.forEach(bindInputElement)
}

function bindInputsInSubtree (node) {
  if (!node) return
  if (node instanceof HTMLInputElement && node.matches(NUMPAD_SELECTOR)) {
    bindInputElement(node)
  }
  if (node instanceof Element || node instanceof DocumentFragment) {
    const nested = node.querySelectorAll?.(NUMPAD_SELECTOR)
    if (nested && nested.length > 0) {
      nested.forEach(bindInputElement)
    }
  }
}

function observeNumpadInputs () {
  if (mutationObserver || typeof MutationObserver === 'undefined') {
    return
  }
  mutationObserver = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(bindInputsInSubtree)
      } else if (mutation.type === 'attributes') {
        bindInputsInSubtree(mutation.target)
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
  initialFieldValue = inputValue
  const initial = normalizeFromField(inputValue)
  currentValue = initial === '' ? '0' : initial
  baseValue = parseNumericValue(currentValue)
  if (baseValue === null) baseValue = 0
  expression = ''
  activeOperator = null
  expressionParts = []

  if (activeInput) {
    activeInput.classList.add(NUMPAD_ACTIVE_CLASS)
  }

  updateDisplays()

  if (overlayHideTimer) {
    clearTimeout(overlayHideTimer)
    overlayHideTimer = null
  }
  overlay.removeAttribute('hidden')
  overlay.removeAttribute('inert')
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
  const commitTarget = activeInput

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

  if (commitTarget) {
    commitTarget.classList.remove(NUMPAD_ACTIVE_CLASS)
  }

  overlay.classList.add('numpad-hidden')
  overlay.setAttribute('aria-hidden', 'true')
  overlay.setAttribute('inert', '')
  if (displayUpdateFrame) {
    cancelAnimationFrame(displayUpdateFrame)
    displayUpdateFrame = null
  }
  if (overlayHideTimer) {
    clearTimeout(overlayHideTimer)
  }
  overlayHideTimer = setTimeout(() => {
    if (overlay) {
      overlay.setAttribute('hidden', '')
    }
  }, NUMPAD_HIDE_DELAY)
  activeInput = null
  initialFieldValue = ''
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

  if (commit && commitTarget) {
    flashCommit(commitTarget)
  }
}

function handleCommitClick () {
  const resolved = evaluatePendingExpression()
  const fallback = parseNumericValue(currentValue)
  const numericResult = resolved ?? fallback ?? baseValue ?? 0

  currentValue = String(numericResult)
  baseValue = numericResult
  activeOperator = null
  expression = ''
  expressionParts = []

  updateDisplays()
  hideNumpad({ commit: true })
}

function handleKeydown (event) {
  if (!isNumpadOpen()) return

  if (event.key === 'Escape') {
    event.preventDefault()
    hideNumpad({ commit: false })
    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    handleCommitClick()
    return
  }

  const mapped = mapKeyboardKey(event.key)
  if (!mapped) return

  handleKey(mapped)
  event.preventDefault()
}

/* Tast-logic */

function handleKey (key) {
  switch (key) {
    case 'C':
      currentValue = '0'
      expression = ''
      baseValue = 0
      activeOperator = null
      expressionParts = []
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
  scheduleDisplayUpdate()
}

function handleOperatorInput (op) {
  const operand = parseNumericValue(currentValue)

  if (operand !== null) {
    upsertOperandInExpression(operand)
    currentValue = ''
  } else if (expressionParts.length === 0) {
    upsertOperandInExpression(Number.isFinite(baseValue) ? baseValue : 0)
  }

  appendOrReplaceOperator(op)
  baseValue = evaluateExpressionParts(buildEvaluationSequence())
  activeOperator = op
}

function applyPendingExpression () {
  const result = evaluatePendingExpression()
  if (result === null || result === undefined) return

  currentValue = String(result)
  baseValue = result
  activeOperator = null
  expression = ''
  expressionParts = []
}

function evaluatePendingExpression () {
  const sequence = buildEvaluationSequence()
  if (!sequence.length) return null

  return evaluateExpressionParts(sequence)
}

/* Display */

function updateDisplays () {
  if (!displayCurrent || !displayExpr) return
  expression = getExpressionText()
  displayExpr.textContent = expression
  displayCurrent.textContent = formatNumber(currentValue)
  updateCommitButtonState()
}

function scheduleDisplayUpdate () {
  if (displayUpdateFrame) return
  if (typeof requestAnimationFrame !== 'function') {
    updateDisplays()
    return
  }
  displayUpdateFrame = requestAnimationFrame(() => {
    displayUpdateFrame = null
    updateDisplays()
  })
}

function updateCommitButtonState () {
  if (!commitBtn) return

  const numericCurrent = parseNumericValue(currentValue)
  const numericInitial = parseNumericValue(initialFieldValue)
  const hasExpression = expressionParts.length > 0 || Boolean(activeOperator)
  const hasChange = hasExpression || (
    numericCurrent !== null && numericCurrent !== (numericInitial ?? 0)
  )

  commitBtn.classList.toggle(NUMPAD_COMMIT_READY_CLASS, hasChange)
}

function getExpressionText () {
  if (!expressionParts.length && !activeOperator) return ''

  const parts = expressionParts.map(part => {
    if (typeof part === 'string') return part
    return formatNumber(part)
  })
  const lastOriginal = expressionParts[expressionParts.length - 1]

  const operand = currentValue === '' ? null : formatNumber(currentValue)
  if (operand !== null && typeof lastOriginal === 'string') {
    parts.push(operand)
  } else if (operand !== null && !parts.length) {
    return ''
  } else if (operand === null && typeof lastOriginal === 'string') {
    parts.pop()
  }

  return parts.join(' ')
}

function upsertOperandInExpression (value) {
  if (expressionParts.length === 0) {
    expressionParts.push(value)
    return
  }

  const lastIndex = expressionParts.length - 1
  if (typeof expressionParts[lastIndex] === 'string') {
    expressionParts.push(value)
  } else {
    expressionParts[lastIndex] = value
  }
}

function appendOrReplaceOperator (operator) {
  if (expressionParts.length === 0) {
    expressionParts.push(0)
  }

  const lastIndex = expressionParts.length - 1
  if (typeof expressionParts[lastIndex] === 'string') {
    expressionParts[lastIndex] = operator
  } else {
    expressionParts.push(operator)
  }
}

function buildEvaluationSequence () {
  const sequence = expressionParts.slice()
  const operand = parseNumericValue(currentValue)

  if (operand !== null) {
    if (!sequence.length) {
      sequence.push(operand)
    } else if (typeof sequence[sequence.length - 1] === 'string') {
      sequence.push(operand)
    } else {
      sequence[sequence.length - 1] = operand
    }
  }

  if (typeof sequence[sequence.length - 1] === 'string') {
    sequence.pop()
  }

  return sequence
}

function evaluateExpressionParts (parts) {
  if (!parts.length) return 0

  const working = parts.slice()

  for (let i = 0; i < working.length; i++) {
    const token = working[i]
    if (token === '×' || token === '÷') {
      const left = Number(working[i - 1] ?? 0)
      const right = Number(working[i + 1] ?? 0)
      const replacement = token === '×'
        ? left * right
        : (right === 0 ? left : left / right)

      working.splice(i - 1, 3, replacement)
      i -= 2
    }
  }

  let result = Number(working[0]) || 0
  for (let i = 1; i < working.length; i += 2) {
    const operator = working[i]
    const value = Number(working[i + 1] ?? 0)
    if (operator === '+') {
      result += value
    } else if (operator === '-') {
      result -= value
    }
  }

  return result
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

function mapKeyboardKey (key) {
  if (/^\d$/.test(key)) return key
  if (key === ',' || key === '.') return ','
  if (key === 'Backspace') return 'BACK'
  if (key === 'Delete') return 'C'
  if (key === '+') return '+'
  if (key === '-') return '-'
  if (key === '*' || key === 'x' || key === 'X') return '×'
  if (key === '/') return '÷'
  if (key === '%') return '%'
  if (key === '=') return '='
  return null
}

function flashCommit (target) {
  if (!target || !(target instanceof HTMLElement)) return
  target.classList.add(NUMPAD_COMMITTED_CLASS)
  setTimeout(() => target.classList.remove(NUMPAD_COMMITTED_CLASS), 420)
}

/* Public init */

export function setupNumpad () {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNumpad)
  } else {
    initNumpad()
  }
}
