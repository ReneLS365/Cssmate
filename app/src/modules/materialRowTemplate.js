function normalizeNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const normalized = trimmed
      .replace(/\s+/g, '')
      .replace(/'/g, '')
      .replace(/(?!^)-/g, '')
      .replace(/,(?=[^,]*,)/g, '')
      .replace(/,(?=[^,]*$)/, '.')
      .replace(/\.(?=.*\.)/g, '');
    const num = Number.parseFloat(normalized);
    return Number.isFinite(num) ? num : 0;
  }
  return 0;
}

function resolveFormatCurrency(formatCurrency) {
  if (typeof formatCurrency === 'function') {
    return formatCurrency;
  }
  return value => {
    const formatter = new Intl.NumberFormat('da-DK', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return formatter.format(Number.isFinite(value) ? value : 0);
  };
}

function resolveToNumber(toNumber) {
  if (typeof toNumber === 'function') return toNumber;
  return normalizeNumber;
}

function createNameCell(item, options, id) {
  const cell = document.createElement('div');
  cell.className = 'csm-name material-name';

  if (item.manual) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'manual-name';
    input.placeholder = 'Manuelt materiale';
    input.value = item.name || '';
    input.dataset.id = id;
    cell.appendChild(input);
  } else {
    const label = document.createElement('span');
    label.className = 'material-label';
    label.textContent = item.name || '';
    cell.appendChild(label);

    const badge = document.createElement('span');
    badge.className = 'system-badge';
    if (options?.systemLabelMap instanceof Map) {
      badge.textContent = options.systemLabelMap.get(item.systemKey) || '';
    }
    if (!badge.textContent && item.systemKey) {
      badge.textContent = String(item.systemKey).toUpperCase();
    }
    if (badge.textContent) {
      cell.appendChild(badge);
    }
  }

  return cell;
}

function createQuantityInput(item, toNumber, id) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'qty mat-qty';
  input.inputMode = 'decimal';
  input.autocomplete = 'off';
  input.dataset.id = id;
  input.setAttribute('data-numpad', 'true');
  input.setAttribute('data-decimal', 'comma');
  input.setAttribute('data-numpad-field', `material-qty-${id}`);

  if (item.manual) {
    input.placeholder = '0';
    if (item.quantity != null && item.quantity !== 0 && item.quantity !== '') {
      input.value = String(item.quantity);
    } else {
      input.value = '';
    }
  } else {
    const quantity = toNumber(item.quantity);
    input.value = String(Number.isFinite(quantity) ? quantity : 0);
  }

  return input;
}

function createPriceInput(item, options, toNumber, id) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'price mat-price';
  input.inputMode = 'decimal';
  input.autocomplete = 'off';
  input.dataset.id = id;
  input.placeholder = '0,00';
  input.setAttribute('data-numpad', 'true');
  input.setAttribute('data-decimal', 'comma');
  input.setAttribute('data-numpad-field', `material-price-${id}`);

  const priceValue = toNumber(item.price);
  const isManual = !!item.manual;
  const isEditable = isManual || !!options?.admin;

  if (isManual) {
    input.value = priceValue > 0 ? priceValue.toFixed(2) : '';
  } else {
    input.value = Number.isFinite(priceValue) ? priceValue.toFixed(2) : '0.00';
  }

  input.readOnly = !isEditable;
  if (priceValue > 0) {
    input.dataset.price = String(priceValue);
  } else {
    input.dataset.price = '';
  }

  return input;
}

function createLineTotal(item, toNumber, formatCurrency) {
  const span = document.createElement('span');
  span.className = 'mat-line mat-sum';
  const price = toNumber(item.price);
  const qty = toNumber(item.quantity);
  const total = price * qty;
  span.textContent = `${formatCurrency(total)} kr`;
  return span;
}

export function createMaterialRow(item, options = {}) {
  if (typeof document === 'undefined') return null;

  const toNumber = resolveToNumber(options.toNumber);
  const formatCurrency = resolveFormatCurrency(options.formatCurrency);

  const id = item?.id != null ? String(item.id) : '';
  const row = document.createElement('div');
  row.className = 'material-row mat-row';
  if (item.manual) {
    row.classList.add('manual');
  }
  if (item.systemKey) {
    row.dataset.system = String(item.systemKey);
  }
  if (id) {
    row.dataset.id = id;
  }

  row.appendChild(createNameCell(item, options, id));
  row.appendChild(createQuantityInput(item, toNumber, id));
  row.appendChild(createPriceInput(item, options, toNumber, id));
  row.appendChild(createLineTotal(item, toNumber, formatCurrency));

  if (typeof window !== 'undefined' && typeof window.updateMaterialLine === 'function') {
    window.requestAnimationFrame(() => {
      try {
        window.updateMaterialLine(row);
      } catch {}
    });
  }

  return { row };
}
