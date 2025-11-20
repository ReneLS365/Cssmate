import { evaluateExpression } from './safe-eval.js';

const DECIMAL_SEPARATOR = ',';

export let lastCopiedFormulaText = '';

let overlay = null;
let panel = null;
let btnClose = null;
let btnCommit = null;
let btnCopy = null;
let dispExpr = null;
let dispPrev = null;
let dispCurrent = null;

let activeTargetInput = null;
let current = '0';
let expression = '';
let previous = '';
let memoryValue = 0;
let initialized = false;
let lastFocusedField = null;

export function initA9Calc () {
  if (initialized) return;
  overlay = document.getElementById('a9-overlay');
  panel = document.querySelector('#a9-overlay .a9-panel');
  dispExpr = document.getElementById('a9-display-expression');
  dispPrev = document.getElementById('a9-display-previous');
  dispCurrent = document.getElementById('a9-display-current');
  btnClose = document.getElementById('a9-btn-close');
  btnCommit = document.getElementById('a9-btn-commit');
  btnCopy = document.getElementById('a9-btn-copy');

  if (!overlay || !panel || !dispExpr || !dispPrev || !dispCurrent || !btnClose || !btnCommit || !btnCopy) {
    return;
  }

  overlay.addEventListener('click', event => {
    if (event.target === overlay) {
      hideA9(false);
      return;
    }
    const keyEl = event.target.closest('[data-a9-key]');
    if (keyEl) {
      event.stopPropagation();
      handleKeyInput(keyEl.dataset.a9Key);
    }
  });

  btnClose.addEventListener('click', () => hideA9(false));
  btnCommit.addEventListener('click', () => hideA9(true));

  btnCopy.addEventListener('click', async () => {
    const text = buildA9CopyString();
    lastCopiedFormulaText = text || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.warn('Kunne ikke kopiere formel til udklipsholderen', error);
    }
  });

  document.addEventListener('keydown', handleKeydown, true);

  initialized = true;
  updateDisplays();
}

// Åbn A9-panelet for et inputfelt og klargør data/fokus
export function openA9ForInput (input) {
  if (!initialized) {
    initA9Calc();
  }
  if (!overlay || !panel) return;

  activeTargetInput = input || null;
  lastFocusedField = activeTargetInput;
  const normalized = normalizeFieldValue(activeTargetInput?.value);
  current = normalized || '0';
  expression = '';
  previous = '';
  updateDisplays();

  overlay.classList.remove('a9-hidden');
  overlay.setAttribute('aria-hidden', 'false');
  panel.focus({ preventScroll: true });
}

// Luk A9-panelet og skriv tilbage til feltet hvis nødvendigt
function hideA9 (commit) {
  if (commit && activeTargetInput) {
    const numeric = parseLocaleNumber(current);
    if (Number.isFinite(numeric)) {
      const valueStr = formatPercentField(numeric);
      activeTargetInput.value = valueStr;
      try {
        activeTargetInput.dataset.a9Commit = '1';
        activeTargetInput.dispatchEvent(new Event('input', { bubbles: true }));
      } finally {
        delete activeTargetInput.dataset.a9Commit;
      }
      const formulaText = lastCopiedFormulaText || buildA9CopyString() || '';
      const detail = { numeric, value: valueStr, formulaText };
      activeTargetInput.dispatchEvent(new CustomEvent('a9-commit', {
        bubbles: true,
        detail
      }));
      activeTargetInput.dispatchEvent(new CustomEvent('a9:commit', {
        bubbles: true,
        detail
      }));
    }
  }

  if (overlay) {
    overlay.classList.add('a9-hidden');
    overlay.setAttribute('aria-hidden', 'true');
  }
  activeTargetInput = null;
  if (lastFocusedField && document.contains(lastFocusedField) && typeof lastFocusedField.focus === 'function') {
    lastFocusedField.focus();
  }
  lastFocusedField = null;
}

function handleKeydown (event) {
  if (!overlay || overlay.classList.contains('a9-hidden')) return;
  if (event.defaultPrevented) return;
  const { key } = event;
  switch (key) {
    case 'Escape':
      event.preventDefault();
      hideA9(false);
      break;
    case 'Enter':
      event.preventDefault();
      hideA9(true);
      break;
    case 'Backspace':
      event.preventDefault();
      handleKeyInput('BACK');
      break;
    case ',':
    case '.':
      event.preventDefault();
      handleKeyInput(',');
      break;
    case '+':
    case '-':
    case '*':
    case 'x':
    case 'X':
    case '÷':
    case '/':
      event.preventDefault();
      handleKeyInput(normalizeOperatorKey(key));
      break;
    case '%':
      event.preventDefault();
      handleKeyInput('%');
      break;
    default:
      if (/^\d$/.test(key)) {
        event.preventDefault();
        handleKeyInput(key);
      }
      break;
  }
}

function normalizeOperatorKey (key) {
  if (key === '*' || key === 'x' || key === 'X') return '×';
  if (key === '/') return '÷';
  return key;
}

function handleKeyInput (key) {
  switch (key) {
    case 'C':
      resetCalc();
      break;
    case 'MC':
      memoryValue = 0;
      break;
    case 'MR':
      current = Number.isFinite(memoryValue) ? String(memoryValue) : '0';
      break;
    case 'M+':
      memoryValue += parseLocaleNumber(current) || 0;
      break;
    case 'M-':
      memoryValue -= parseLocaleNumber(current) || 0;
      break;
    case 'BACK':
      if (current.length > 1) {
        current = current.slice(0, -1);
      } else {
        current = '0';
      }
      break;
    case '%':
      current = String((parseLocaleNumber(current) || 0) / 100);
      break;
    case '+':
    case '-':
    case '×':
    case '÷':
      queueOperator(key);
      break;
    case '=':
      compute();
      break;
    case ',':
      if (!current.includes('.')) {
        current += '.';
      }
      break;
    default:
      if (/^\d$/.test(key)) {
        if (current === '0') {
          current = key;
        } else {
          current += key;
        }
      }
      break;
  }

  updateDisplays();
}

function resetCalc () {
  current = '0';
  expression = '';
  previous = '';
  memoryValue = 0;
  updateDisplays();
}

function queueOperator (operator) {
  const trimmed = current.trim();
  if (!trimmed) return;
  if (!expression) {
    expression = `${formatExpressionNumber(trimmed)} ${operator} `;
  } else {
    expression += `${formatExpressionNumber(trimmed)} ${operator} `;
  }
  previous = '';
  current = '0';
}

function compute () {
  const expr = `${expression}${formatExpressionNumber(current)}`.trim();
  if (!expr) return;

  try {
    const result = evaluateExpression(expr);
    if (!Number.isFinite(result)) return;

    previous = expr;
    current = String(result);
    expression = '';

    const text = buildA9CopyString();
    if (text) {
      lastCopiedFormulaText = text;
    }
  } catch (error) {
    console.warn('Ugyldig udregning', error);
    expression = '';
  }
}

function updateDisplays () {
  if (!dispCurrent || !dispPrev || !dispExpr) return;
  dispExpr.textContent = expression;
  dispPrev.textContent = previous;
  dispCurrent.textContent = formatDisplay(current);
}

function formatDisplay (value) {
  const number = parseLocaleNumber(value);
  if (!Number.isFinite(number)) {
    return '0';
  }
  return number.toLocaleString('da-DK', { maximumFractionDigits: 6 });
}

function formatPercentField (value) {
  return Number(value || 0).toFixed(2).replace('.', DECIMAL_SEPARATOR);
}

function formatExpressionNumber (value) {
  if (typeof value !== 'string') {
    return String(value ?? '');
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.replace(/[.,]/g, DECIMAL_SEPARATOR);
}

function parseLocaleNumber (value) {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value !== 'string') {
    return Number.NaN;
  }
  const normalized = value.replace(/\s+/g, '').replace(/,/g, '.');
  if (!normalized) return Number.NaN;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function normalizeFieldValue (value) {
  if (value == null) return '';
  const numeric = parseLocaleNumber(String(value));
  if (!Number.isFinite(numeric)) return '';
  return String(numeric);
}

export function buildA9CopyString () {
  const resultNumber = parseLocaleNumber(current);
  if (!Number.isFinite(resultNumber)) {
    return '';
  }
  let exprSource = previous;
  if (!exprSource) {
    if (expression) {
      const pending = `${expression}${formatExpressionNumber(current)}`.trim();
      exprSource = pending || expression.trim();
    } else {
      exprSource = formatExpressionNumber(current);
    }
  }
  const expressionText = exprSource.replace(/\s+/g, ' ').replace(/\./g, ',');
  const resultText = formatPercentField(resultNumber);
  return `${expressionText} = ${resultText} %`;
}
