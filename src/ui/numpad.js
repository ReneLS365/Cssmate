const OPERATOR_MAP = new Map([
  ['×', '*'],
  ['÷', '/'],
]);

function sanitizeExpression(input) {
  if (!input) return '';
  return String(input)
    .replace(/,/g, '.')
    .replace(/[×÷]/g, char => OPERATOR_MAP.get(char) || char)
    .replace(/[^0-9+\-*/.]/g, '');
}

export function evalExpr(expr, baseValue = 0) {
  const sanitized = sanitizeExpression(expr);
  if (!sanitized) return Number(baseValue) || 0;

  const base = Number(baseValue) || 0;
  const needsBasePrefix = /^[+\-*/]/.test(sanitized);
  const payload = needsBasePrefix ? `${base}${sanitized}` : sanitized;

  try {
    // eslint-disable-next-line no-new-func
    const result = new Function(`return (${payload})`)();
    if (typeof result !== 'number' || !Number.isFinite(result)) {
      return base;
    }
    return result;
  } catch (error) {
    return base;
  }
}

const FOCUSABLE_SELECTOR = 'input[data-numpad], input[data-numpad-field], input[data-numpad=true], input.mat-qty, textarea[data-numpad]';

function formatValue(value, useComma = true) {
  const safe = Number.isFinite(Number(value)) ? Number(value) : 0;
  let text = safe.toFixed(6).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  if (text.endsWith('.')) {
    text = text.slice(0, -1);
  }
  if (!text) text = '0';
  if (useComma) {
    text = text.replace('.', ',');
  }
  return text;
}

export function createNumpadController() {
  const overlay = document.getElementById('npOverlay');
  const dialog = overlay?.querySelector('[data-testid="numpad-dialog"]');
  const screen = overlay?.querySelector('#npScreen');
  const closeBtn = overlay?.querySelector('[data-key="close"]');
  const equalsBtn = overlay?.querySelector('[data-key="="]');
  const enterBtn = overlay?.querySelector('[data-key="enter"]');
  const buttons = overlay ? Array.from(overlay.querySelectorAll('button[data-key]')) : [];

  if (!overlay || !dialog || !screen || !buttons.length) {
    return {
      open() {},
      close() {},
      isOpen: () => false,
    };
  }

  const state = {
    activeInput: null,
    baseValue: 0,
    expression: '',
    decimalComma: true,
    focusDirection: 'none',
  };

  const updateScreen = value => {
    screen.textContent = value;
  };

  const applyExpression = ({ commit = false } = {}) => {
    const result = evalExpr(state.expression, state.baseValue);
    if (commit && state.activeInput) {
      const formatted = formatValue(result, state.decimalComma);
      state.activeInput.value = formatted;
      state.activeInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    updateScreen(formatValue(result, state.decimalComma));
  };

  const focusRelative = direction => {
    if (!state.activeInput || !direction || direction === 'none') return;
    const focusables = Array.from(document.querySelectorAll(FOCUSABLE_SELECTOR));
    const currentIndex = focusables.indexOf(state.activeInput);
    if (currentIndex === -1) return;
    const offset = direction === 'forward' ? 1 : -1;
    const next = focusables[currentIndex + offset];
    if (next && typeof next.focus === 'function') {
      next.focus();
      if (typeof next.select === 'function') {
        next.select();
      }
    }
  };

  const closeOverlay = (direction = 'none') => {
    if (!overlay.classList.contains('open')) return;
    state.focusDirection = direction;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('numpad-open');
    document.body.dataset.numpadClosing = '1';
    setTimeout(() => {
      if (document.body.dataset.numpadClosing === '1') {
        delete document.body.dataset.numpadClosing;
      }
    }, 250);
    if (state.activeInput) {
      if (direction === 'none' && typeof state.activeInput.focus === 'function') {
        state.activeInput.focus();
        if (typeof state.activeInput.select === 'function') {
          state.activeInput.select();
        }
      } else {
        focusRelative(direction);
      }
    }
    state.activeInput = null;
    state.expression = '';
    updateScreen('0');
  };

  const handleKey = key => {
    if (!state.activeInput) return;

    switch (key) {
      case 'enter':
        applyExpression({ commit: true });
        closeOverlay('none');
        break;
      case 'close':
        closeOverlay('none');
        break;
      case '=':
        applyExpression({ commit: true });
        closeOverlay('forward');
        break;
      case 'C':
        state.expression = '';
        updateScreen('0');
        break;
      default: {
        if (key === ',') {
          if (!state.expression.includes(',')) {
            state.expression += ',';
          }
        } else if (key === '+' || key === '-') {
          state.expression += key;
        } else if (key === '×' || key === '÷' || key === '*' || key === '/') {
          state.expression += key === '×' ? '×' : key === '÷' ? '÷' : key;
        } else if (/^\d$/.test(key)) {
          state.expression += key;
        }
        if (state.expression) {
          applyExpression();
        } else {
          updateScreen(formatValue(state.baseValue, state.decimalComma));
        }
      }
    }
  };

  const onButtonClick = event => {
    const key = event.currentTarget?.dataset?.key;
    if (!key) return;
    event.preventDefault();
    handleKey(key);
  };

  buttons.forEach(button => button.addEventListener('click', onButtonClick));
  overlay.addEventListener('click', event => {
    if (event.target === overlay) {
      closeOverlay('none');
    }
  });
  closeBtn?.addEventListener('click', () => closeOverlay('none'));
  equalsBtn?.addEventListener('click', () => handleKey('='));
  enterBtn?.addEventListener('click', () => handleKey('enter'));

  return {
    open(input) {
      if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) {
        return;
      }
      state.activeInput = input;
      state.baseValue = input.value ? evalExpr(input.value, 0) : 0;
      state.decimalComma = input.dataset.decimal === 'comma' || /,/.test(input.value || '');
      state.expression = '';
      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.classList.add('numpad-open');
      updateScreen(formatValue(state.baseValue, state.decimalComma));
      dialog.focus();
    },
    close: closeOverlay,
    isOpen: () => overlay.classList.contains('open'),
    getActiveInput: () => state.activeInput,
  };
}
