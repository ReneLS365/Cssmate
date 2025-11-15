// js/numpad.js
// Simpelt numpad + lommeregner til mobil

let overlay, displayMem, displayExpr, displayCurrent;
let commitBtn, closeBtn;
let activeInput = null;

let memoryValue = 0;
let currentValue = '0';
let expression = '';   // fx "120+30×2"

function initNumpad() {
  overlay = document.getElementById('numpad-overlay');
  if (!overlay) return;

  displayMem = document.getElementById('numpad-display-memory');
  displayExpr = document.getElementById('numpad-display-expression');
  displayCurrent = document.getElementById('numpad-display-current');
  commitBtn = document.getElementById('numpad-btn-commit');
  closeBtn = document.getElementById('numpad-btn-close');

  // Global key-handler på overlayet
  overlay.addEventListener('click', (e) => {
    const keyEl = e.target.closest('.numpad-key');
    if (keyEl) {
      handleKey(keyEl.dataset.key);
      e.stopPropagation();
      return;
    }

    if (e.target === overlay) {
      // klik udenfor panelet = luk uden commit
      hideNumpad(false);
    }
  });

  commitBtn.addEventListener('click', () => hideNumpad(true));
  closeBtn.addEventListener('click', () => hideNumpad(false));

  document.addEventListener('focusin', handleFocusIn);
  document.addEventListener('beforeinput', handleBeforeInput, true);
}

function handleFocusIn(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }

  if (target.dataset.clearZeroOnFocus === 'true' && (target.value === '0' || target.value === '0,00')) {
    target.value = '';
  }

  if (target.dataset.numpad === 'true') {
    target.setAttribute('inputmode', 'numeric');
    if (target.value === '0' || target.value === '0,00') {
      target.value = '';
    }
    showNumpadForInput(target);
  }
}

function handleBeforeInput(event) {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.dataset.numpad === 'true') {
    event.preventDefault();
  }
}

function showNumpadForInput(input) {
  activeInput = input;
  const initial = normalizeFromField(input.value);

  currentValue = initial === '' ? '0' : initial;
  expression = '';
  updateDisplays();

  overlay.classList.remove('numpad-hidden');
  overlay.setAttribute('aria-hidden', 'false');
}

function hideNumpad(commit) {
  if (commit && activeInput) {
    // Brug currentValue som feltets tekst, konverteret til komma-decimal
    const fieldValue = formatForField(currentValue);
    activeInput.value = fieldValue;
  }
  overlay.classList.add('numpad-hidden');
  overlay.setAttribute('aria-hidden', 'true');
  activeInput = null;
}

/* Tast-logic */

function handleKey(key) {
  switch (key) {
    case 'C':
      currentValue = '0';
      expression = '';
      break;
    case 'BACK':
      if (currentValue.length > 1) {
        currentValue = currentValue.slice(0, -1);
      } else {
        currentValue = '0';
      }
      break;
    case '%':
      // procent af nuværende value
      currentValue = String(parseFloat(currentValue || '0') / 100);
      break;
    case '+':
    case '-':
    case '×':
    case '÷':
      // færdiggør nuværende tal til udtryk
      addCurrentToExpression(key);
      currentValue = '0';
      break;
    case '=':
      computeExpression();
      break;
    case ',':
      if (!currentValue.includes('.')) {
        currentValue = currentValue + '.';
      }
      break;
    default:
      // tal
      if (/^\d$/.test(key)) {
        if (currentValue === '0') currentValue = key;
        else currentValue += key;
      }
      break;
  }
  updateDisplays();
}

function addCurrentToExpression(op) {
  const val = currentValue === '' ? '0' : currentValue;
  if (!expression) {
    expression = val + ' ' + op + ' ';
  } else {
    expression = expression + val + ' ' + op + ' ';
  }
}

function computeExpression() {
  // byg komplet streng og eval lavt niveau (kun tal og + - * /)
  let expr = expression + (currentValue || '0');
  if (!expr.trim()) return;

  const safe = expr
    .replace(/×/g, '*')
    .replace(/÷/g, '/');

  try {
    let result = Function(`"use strict"; return (${safe})`)();
    if (!Number.isFinite(result)) return;
    currentValue = String(result);
    expression = '';
  } catch (e) {
    // ved fejl nulstilles kun udtryk
    expression = '';
  }
}

/* Display-opdatering */

function updateDisplays() {
  displayMem.textContent = 'M: ' + formatNumber(memoryValue);
  displayExpr.textContent = expression.replace(/\./g, ',');
  displayCurrent.textContent = formatNumber(currentValue);
}

function formatNumber(v) {
  if (v === '' || v === null || v === undefined) return '0';
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  return String(n).replace('.', ',');
}

function normalizeFromField(v) {
  if (!v) return '';
  return String(v).replace(',', '.').replace(/[^0-9.\-]/g, '');
}

function formatForField(v) {
  return formatNumber(v);
}

/* Offentlig init */

export function setupNumpad() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNumpad);
  } else {
    initNumpad();
  }
}
