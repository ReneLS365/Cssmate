function resolveRow(result, item, index) {
  if (!result) return null;
  if (result instanceof HTMLElement) {
    return { row: result };
  }
  const row = result.row instanceof HTMLElement ? result.row : null;
  if (!row) return null;

  if (typeof result.update === 'function') {
    result.update(item, index);
  }

  return {
    row,
    destroy: typeof result.destroy === 'function' ? result.destroy : null,
  };
}

export function createVirtualMaterialsList(options = {}) {
  const { container, items = [], renderRow } = options;
  if (!(container instanceof HTMLElement) || typeof renderRow !== 'function') {
    return {
      update() {},
      refresh() {},
      destroy() {},
    };
  }

  container.classList.add('materials-virtual-list');

  let currentItems = Array.isArray(items) ? items.slice() : [];
  let rendered = [];

  function clearRendered() {
    rendered.forEach(entry => entry.destroy?.());
    rendered = [];
  }

  function renderAll(list) {
    clearRendered();
    container.innerHTML = '';

    list.forEach((item, index) => {
      const result = resolveRow(renderRow(item, index), item, index);
      if (!result?.row) return;
      container.appendChild(result.row);
      rendered.push(result);
    });
  }

  renderAll(currentItems);

  return {
    update(nextItems = []) {
      currentItems = Array.isArray(nextItems) ? nextItems.slice() : [];
      renderAll(currentItems);
    },
    refresh() {
      renderAll(currentItems);
    },
    destroy() {
      clearRendered();
      container.innerHTML = '';
      currentItems = [];
    },
  };
}
