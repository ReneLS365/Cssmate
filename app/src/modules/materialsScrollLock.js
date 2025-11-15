const listeners = new WeakMap();

function normalizeElement(root) {
  if (!(root instanceof HTMLElement)) {
    return document.querySelector('.materials-scroll') || null;
  }
  return root.closest('.materials-scroll') || root;
}

function createWheelHandler(element) {
  return function handleWheel(event) {
    if (!element || event.defaultPrevented) return;
    const deltaY = event.deltaY;
    if (!deltaY) return;

    const { scrollTop, scrollHeight, clientHeight } = element;
    const atTop = scrollTop <= 0 && deltaY < 0;
    const atBottom = scrollTop + clientHeight >= scrollHeight && deltaY > 0;

    if (atTop || atBottom) {
      return;
    }

    event.stopPropagation();
  };
}

function createTouchHandlers(element) {
  const state = { startY: 0 };
  const onStart = event => {
    if (!event.touches || event.touches.length === 0) return;
    state.startY = event.touches[0].clientY;
  };

  const onMove = event => {
    if (!element || !event.touches || event.touches.length === 0) return;
    const currentY = event.touches[0].clientY;
    const deltaY = state.startY - currentY;

    const { scrollTop, scrollHeight, clientHeight } = element;
    const atTop = scrollTop <= 0 && deltaY < 0;
    const atBottom = scrollTop + clientHeight >= scrollHeight && deltaY > 0;

    if (atTop || atBottom) {
      return;
    }

    event.stopPropagation();
  };

  return { onStart, onMove };
}

export function initMaterialsScrollLock(root) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const element = normalizeElement(root);
  if (!element || listeners.has(element)) return;

  const wheelHandler = createWheelHandler(element);
  const touchHandlers = createTouchHandlers(element);

  element.addEventListener('wheel', wheelHandler, { passive: false });
  element.addEventListener('touchstart', touchHandlers.onStart, { passive: true });
  element.addEventListener('touchmove', touchHandlers.onMove, { passive: false });

  listeners.set(element, () => {
    element.removeEventListener('wheel', wheelHandler);
    element.removeEventListener('touchstart', touchHandlers.onStart);
    element.removeEventListener('touchmove', touchHandlers.onMove);
  });
}

export function destroyMaterialsScrollLock(root) {
  const element = normalizeElement(root);
  const cleanup = element ? listeners.get(element) : null;
  if (!cleanup) return;
  cleanup();
  listeners.delete(element);
}
