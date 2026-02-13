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
let suppressTimer = null
const NUMPAD_ACTIVE_CLASS = 'numpad-target-active'
const NUMPAD_COMMIT_READY_CLASS = 'numpad-commit--ready'
const NUMPAD_COMMITTED_CLASS = 'numpad-committed'
let initialFieldValue = ''
let displayUpdateFrame = null
let keyboardBlockActive = false
let commitInProgress = false
let lastPointerDownAt = 0
const POINTER_FOCUS_GUARD_MS = 450
let pointerRequestedInput = null
const DEBUG_NUMPAD = Boolean(
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) ||
  (typeof import.meta !== 'undefined' && import.meta.env && String(import.meta.env.VITE_DEBUG_NUMPAD ?? '') === '1')
)
const debugGuardRef = { t: 0, key: '', count: 0 }
const keyPressGuardRef = { t: 0, key: '', source: '' }
const KEY_PRESS_GUARD_MS = 120

function debugKeyPress (key) {
  if (!DEBUG_NUMPAD) return
  const now = performance.now()
  if (debugGuardRef.key === key && now - debugGuardRef.t < 300) {
    debugGuardRef.count += 1
    if (debugGuardRef.count >= 2) {
      console.warn('[numpad] double-trigger detected', { key, deltaMs: now - debugGuardRef.t })
    }
    return
  }
  debugGuardRef.t = now
  debugGuardRef.key = key
  debugGuardRef.count = 1
}

function shouldHandleKeyPress (key, source) {
  const now = performance.now()
  if (
    keyPressGuardRef.key === key &&
    keyPressGuardRef.source !== source &&
    now - keyPressGuardRef.t < KEY_PRESS_GUARD_MS
  ) {
    return false
  }
  keyPressGuardRef.t = now
  keyPressGuardRef.key = key
  keyPressGuardRef.source = source
  return true
}


function isNumpadDisabledForE2E () {
  const metaEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
  const windowEnv = typeof window !== 'undefined' ? window : {}
  const embeddedEnv = windowEnv.__ENV__ || {}
  const raw = String(
    metaEnv.VITE_E2E_DISABLE_NUMPAD
      || embeddedEnv.VITE_E2E_DISABLE_NUMPAD
      || windowEnv.VITE_E2E_DISABLE_NUMPAD
      || ''
  ).trim().toLowerCase()
  return raw === '1' || raw === 'true'
}

function isNumpadOpen () {
  return Boolean(overlay && !overlay.classList.contains('numpad-hidden'))
}

function initNumpad () {
  if (isNumpadDisabledForE2E()) return

  overlay = document.querySelector('[data-numpad-overlay]') || document.getElementById('numpad-overlay')
  if (!overlay) return

  overlay.classList.add('numpad-hidden')
  overlay.setAttribute('aria-hidden', 'true')
  overlay.setAttribute('hidden', '')
  overlay.setAttribute('inert', '')

  // Ensure overlay is not trapped inside transformed/scaled containers (Android fixed-position bug)
  try {
    if (overlay.parentElement && overlay.parentElement !== document.body) {
      document.body.appendChild(overlay)
    }
  } catch (e) {
    // ignore
  }

  dialog = overlay.querySelector('[data-numpad-dialog]') || overlay.querySelector('.numpad-panel')

  displayExpr = document.getElementById('numpad-display-expression')
  displayCurrent = document.getElementById('numpad-display-current')
  commitBtn = document.getElementById('numpad-btn-commit')
  closeBtn = document.getElementById('numpad-btn-close')

  overlay.addEventListener('pointerdown', handleOverlayPointerDown, { passive: false })

  if (commitBtn) {
    commitBtn.addEventListener('pointerdown', event => {
      event.preventDefault()
      event.stopPropagation()
      debugKeyPress('commit')
      if (!shouldHandleKeyPress('commit', 'pointerdown')) return
      handleCommitClick()
    }, { passive: false })
    commitBtn.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
    })
  }
  if (closeBtn) {
    closeBtn.addEventListener('pointerdown', event => {
      event.preventDefault()
      event.stopPropagation()
      hideNumpad({ commit: false })
    }, { passive: false })
    closeBtn.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
    })
  }

  overlay.querySelectorAll('.numpad-key').forEach(keyBtn => {
    const keyValue = keyBtn.dataset.key
    if (!keyValue) return
    keyBtn.addEventListener('pointerdown', event => {
      event.preventDefault()
      event.stopPropagation()
      debugKeyPress(keyValue)
      if (!shouldHandleKeyPress(keyValue, 'pointerdown')) return
      handleKey(keyValue)
    }, { passive: false })
    keyBtn.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
    })
  })

  document.addEventListener('keydown', handleKeydown)
  document.addEventListener('pointerdown', recordPointerDown, true)
  document.addEventListener('cssmate:tab-change', handleTabChange)

  bindInputs()
  observeNumpadInputs()
}

function handleKeyboardBlock (event) {
  if (!isNumpadOpen()) return
  if (event.key === 'Escape' || event.key === 'Enter') return
  event.preventDefault()
  event.stopPropagation()
}

function startKeyboardBlock () {
  if (keyboardBlockActive) return
  window.addEventListener('keydown', handleKeyboardBlock, true)
  keyboardBlockActive = true
}

function stopKeyboardBlock () {
  if (!keyboardBlockActive) return
  window.removeEventListener('keydown', handleKeyboardBlock, true)
  keyboardBlockActive = false
}

function setSuppressNextFocus (durationMs = 250) {
  suppressNextFocus = true
  if (suppressTimer) {
    clearTimeout(suppressTimer)
  }
  suppressTimer = setTimeout(() => {
    suppressNextFocus = false
    suppressTimer = null
  }, durationMs)
}

function clearSuppressNextFocus () {
  suppressNextFocus = false
  if (suppressTimer) {
    clearTimeout(suppressTimer)
    suppressTimer = null
  }
}

function handleNumpadFocus (event) {
  const input = event.currentTarget
  if (!(input instanceof HTMLInputElement)) return
  if (isNumpadOpen()) return
  if (suppressNextFocus) {
    return
  }
  if (!shouldOpenOnFocus(input)) {
    return
  }

  const rawValue = (input.value || '').trim()
  const isZeroLike = rawValue === '' || rawValue === '0' || rawValue === '0,0' || rawValue === '0,00'

  if (isZeroLike) {
    input.value = ''
  }

  showNumpadForInput(input)
}

function recordPointerDown () {
  lastPointerDownAt = performance.now()
}

function shouldOpenOnFocus (input) {
  if (!input) return false
  if (pointerRequestedInput === input) return true
  if (input.dataset.numpad === 'true' || input.type === 'number') return true
  if (typeof input.matches === 'function' && input.matches(':focus-visible')) {
    return true
  }
  const now = performance.now()
  return now - lastPointerDownAt > POINTER_FOCUS_GUARD_MS
}

function handleNumpadPointerDown (event) {
  const input = event.currentTarget
  if (!(input instanceof HTMLInputElement)) return
  if (isNumpadOpen()) return
  pointerRequestedInput = input
  requestAnimationFrame(() => {
    if (!pointerRequestedInput || pointerRequestedInput !== input) return
    pointerRequestedInput = null
    if (isNumpadOpen()) return
    if (typeof input.focus === 'function') {
      input.focus({ preventScroll: true })
    }
    showNumpadForInput(input)
  })
}

function handleOverlayPointerDown (event) {
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
    input.addEventListener('click', handleNumpadPointerDown)
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
  if (dialog) {
    dialog.style.opacity = '0'
    dialog.style.transform = 'translate3d(0, 6px, 0)'
  }
  startKeyboardBlock()
  if (dialog) {
    requestAnimationFrame(() => {
      dialog.style.opacity = '1'
      dialog.style.transform = 'translate3d(0, 0, 0)'
    })
  }
}

function hideNumpad ({ commit = false } = {}) {
  if (!overlay) return
  pointerRequestedInput = null

  let focusTarget = lastFocusedInput
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

  if (commit && commitTarget?.blur) {
    try {
      commitTarget.blur()
    } catch {
      // ignore blur errors
    }
  }

  overlay.classList.add('numpad-hidden')
  overlay.setAttribute('aria-hidden', 'true')
  overlay.setAttribute('inert', '')
  overlay.setAttribute('hidden', '')
  stopKeyboardBlock()
  if (displayUpdateFrame) {
    cancelAnimationFrame(displayUpdateFrame)
    displayUpdateFrame = null
  }
  activeInput = null
  initialFieldValue = ''
  if (document?.documentElement) {
    document.documentElement.classList.remove('np-open')
  }
  if (commit) {
    setSuppressNextFocus(250)
    focusTarget = document.body || null
  }
  if (focusTarget && document.contains(focusTarget) && typeof focusTarget.focus === 'function') {
    if (!commit) {
      setSuppressNextFocus(250)
    }
    focusTarget.focus()
  } else if (!commit) {
    clearSuppressNextFocus()
  }
  lastFocusedInput = null

  if (commit && commitTarget) {
    flashCommit(commitTarget)
  }
}

function handleTabChange () {
  if (!isNumpadOpen()) return
  hideNumpad({ commit: false })
}

function handleCommitClick () {
  if (commitInProgress) return
  commitInProgress = true
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      commitInProgress = false
    })
  } else {
    setTimeout(() => {
      commitInProgress = false
    }, 0)
  }

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
