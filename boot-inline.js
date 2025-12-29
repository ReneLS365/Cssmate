const currencyFormatter = new Intl.NumberFormat('da-DK', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function parseQty(value) {
  if (value == null) return 0;
  let normalized = String(value).trim();
  if (!normalized) return 0;
  normalized = normalized.replace(/\s+/g, '');
  const commaIndex = normalized.lastIndexOf(',');
  const dotIndex = normalized.lastIndexOf('.');
  if (commaIndex > -1 && dotIndex > -1) {
    if (dotIndex < commaIndex) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else {
    normalized = normalized.replace(',', '.');
  }
  normalized = normalized.replace(/[^0-9.]/g, '');
  const firstDot = normalized.indexOf('.');
  if (firstDot !== -1) {
    normalized = `${normalized.slice(0, firstDot + 1)}${normalized.slice(firstDot + 1).replace(/\./g, '')}`;
  }
  if (!normalized || normalized === '.') {
    return 0;
  }
  const num = parseFloat(normalized);
  if (!Number.isFinite(num) || num < 0) {
    return 0;
  }
  return num;
}

function formatQtyDK(value) {
  return value
    .toFixed(6)
    .replace(/0+$/, '')
    .replace(/\.$/, '')
    .replace('.', ',');
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function updateMaterialLine(row) {
  if (!row) return;
  const qtyInput = row.querySelector('.mat-qty');
  const priceInput = row.querySelector('.mat-price');
  const lineOutput = row.querySelector('.mat-line');
  if (!qtyInput || !priceInput || !lineOutput) return;

  const qty = parseQty(qtyInput.value);
  let price = Number.parseFloat(priceInput.dataset.price || '');
  if (!Number.isFinite(price)) {
    price = parseQty(priceInput.value);
  }
  const total = round2(qty * (Number.isFinite(price) ? price : 0));
  const formattedQty = formatQtyDK(qty);
  qtyInput.value = qtyInput.type === 'number' ? formattedQty.replace(',', '.') : formattedQty;

  const hasQty = qty > 0;
  row.toggleAttribute('data-has-qty', hasQty);
  row.dataset.hasQty = hasQty ? 'true' : 'false';

  if (Number.isFinite(price)) {
    const formattedPrice = price.toFixed(2);
    priceInput.value = priceInput.type === 'number'
      ? formattedPrice
      : formattedPrice.replace('.', ',');
  } else if (priceInput.type === 'number') {
    const parsed = parseQty(priceInput.value);
    priceInput.value = Number.isFinite(parsed) ? String(parsed) : '';
  } else {
    priceInput.value = String(priceInput.value).replace('.', ',');
  }

  const formattedLine = `${currencyFormatter.format(total)} kr`;
  if (lineOutput instanceof HTMLInputElement) {
    lineOutput.value = formattedLine;
  } else {
    lineOutput.textContent = formattedLine;
  }
}

export function initMaterialRowEnhancements() {
  const container = document.getElementById('optaellingContainer');
  if (!container) return;

  const refreshRows = () => {
    container.querySelectorAll('.mat-row').forEach(row => updateMaterialLine(row));
  };

  refreshRows();

  container.addEventListener('input', event => {
    if (!event.target.classList.contains('mat-qty')) return;
    const row = event.target.closest('.mat-row');
    updateMaterialLine(row);
    if (typeof window.recalcTotals === 'function') {
      window.recalcTotals();
    } else if (typeof window.updateTotals === 'function') {
      window.updateTotals();
    }
  });

  const observer = new MutationObserver(records => {
    let needsRefresh = false;
    records.forEach(record => {
      if (record.type === 'childList') {
        record.addedNodes.forEach(node => {
          if (node instanceof Element && (node.classList.contains('mat-row') || node.querySelector('.mat-row'))) {
            needsRefresh = true;
          }
        });
      } else if (record.type === 'attributes' && record.attributeName === 'data-price') {
        needsRefresh = true;
      }
    });
    if (needsRefresh) {
      refreshRows();
    }
  });

  observer.observe(container, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-price'],
  });
}

export function registerServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  const searchParams = new URLSearchParams(window.location.search || '');
  if (window.CSSMATE_IS_CI === true) {
    console.info('Service worker registration skipped in CI');
    return;
  }
  if (searchParams.get('lh') === '1') {
    console.info('Service worker registration skipped for Lighthouse');
    return;
  }
  if (searchParams.has('no-sw')) {
    console.info('Service worker registration skipped via no-sw flag');
    return;
  }

  window.addEventListener('load', () => {
    const baseUrl = new URL('.', window.location.href);
    const swUrl = new URL('service-worker.js', baseUrl);
    const scope = baseUrl.pathname.endsWith('/') ? baseUrl.pathname : `${baseUrl.pathname}/`;

    navigator.serviceWorker.register(swUrl.href, { scope })
      .then(registration => {
        const tryActivateWaiting = () => {
          const hasController = Boolean(navigator.serviceWorker?.controller);
          if (registration.waiting && hasController) {
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
        };

        tryActivateWaiting();

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            const isInstalled = newWorker.state === 'installed';
            const hasController = Boolean(navigator.serviceWorker?.controller);
            if (isInstalled && hasController) {
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      })
      .catch(async error => {
        const offline = navigator.onLine === false;
        const transientErrors = new Set(['AbortError', 'NetworkError']);
        const message = typeof error?.message === 'string' ? error.message : '';
        if (offline || (typeof error === 'object' && error !== null && transientErrors.has(error.name)) || /(?:offline|network)/i.test(message)) {
          console.warn('Service worker registration failed due to network issues; keeping existing worker', error);
          return;
        }
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map(reg => reg.unregister()));
        } finally {
          const nextUrl = new URL(window.location.href);
          nextUrl.searchParams.set('no-sw', Date.now().toString());
          window.location.replace(nextUrl.toString());
        }
      });
  });
}

export function exposeBootHelpers() {
  if (typeof window === 'undefined') {
    return;
  }
  window.parseQty = parseQty;
  window.formatQtyDK = formatQtyDK;
  window.round2 = round2;
  window.updateMaterialLine = row => updateMaterialLine(row);
}

export function initBootInline() {
  exposeBootHelpers();
  initMaterialRowEnhancements();
  registerServiceWorker();
}
