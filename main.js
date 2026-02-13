function runWhenIdle(fn) {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(fn, { timeout: 1500 });
    return;
  }
  setTimeout(fn, 150);
}

function updateAppViewportHeight() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const height = window.visualViewport?.height || window.innerHeight;
  if (!height) return;
  document.documentElement.style.setProperty('--app-vh', `${height * 0.01}px`);
}

function registerViewportHeightListener() {
  if (typeof window === 'undefined') return;
  let resizeTimer = null;
  const scheduleUpdate = () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      updateAppViewportHeight();
    }, 120);
  };

  updateAppViewportHeight();
  window.addEventListener('resize', scheduleUpdate, { passive: true });
  window.addEventListener('orientationchange', scheduleUpdate, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleUpdate, { passive: true });
  }
}

let bootstrapPromise = null;


async function installE2EExportHook() {
  if (typeof window === 'undefined') return
  try {
    const metaEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
    const embeddedEnv = window.__ENV__ || {}
    const flag = String(
      metaEnv.VITE_E2E
      || embeddedEnv.VITE_E2E
      || window.VITE_E2E
      || ''
    ).trim().toLowerCase()
    const enabled = flag === '1' || flag === 'true'
    if (!enabled) return
    const mod = await import('./js/run-export.js')
    if (typeof mod?.runExport !== 'function') return
    window.__EXPORT__ = () => mod.runExport()
  } catch (error) {
    console.warn('Kunne ikke eksponere E2E export hook', error)
  }
}


function shouldMountDiagnostics() {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('diag') === '1') return true;
    return window.location.pathname.startsWith('/diag') || window.location.pathname.startsWith('/_diag');
  } catch (_) {
    return false;
  }
}

function shouldResetApp() {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('reset') === '1';
  } catch (_) {
    return false;
  }
}

function bootstrapDiagnostics() {
  if (typeof window === 'undefined') return;
  const wantsReset = shouldResetApp();
  const wantsDiag = shouldMountDiagnostics();
  if (!wantsReset && !wantsDiag) return;

  import('./src/ui/auth-diagnostics.js')
    .then(mod => {
      if (wantsReset && typeof mod?.startResetFlow === 'function') {
        mod.startResetFlow();
        return;
      }
      if (wantsDiag && typeof mod?.mountDiagnostics === 'function') {
        mod.mountDiagnostics({ forceVisible: true, allowSwReset: true });
      }
    })
    .catch(error => {
      console.warn('Kunne ikke starte auth diagnostics', error);
    });
}

function scheduleBootstrap() {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.add('app-booting');
  }

  registerViewportHeightListener();
  bootstrapDiagnostics();
  installE2EExportHook();

  const start = () => {
    runWhenIdle(() => {
      if (bootstrapPromise) return;
      bootstrapPromise = import('./app-main.js')
        .then(mod => mod?.bootstrapApp?.())
        .catch(error => {
          bootstrapPromise = null;
          console.warn('Kunne ikke starte Cssmate', error);
        });
    });
  };

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => start());
  } else {
    start();
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleBootstrap, { once: true });
  } else {
    scheduleBootstrap();
  }
}

export async function applyImportedAkkordData(...args) {
  const mod = await import('./app-main.js');
  if (typeof mod?.applyImportedAkkordData !== 'function') {
    throw new Error('applyImportedAkkordData er ikke tilgængelig');
  }
  return mod.applyImportedAkkordData(...args);
}
