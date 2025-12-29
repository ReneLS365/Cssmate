function runWhenIdle(fn) {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(fn, { timeout: 1500 });
    return;
  }
  setTimeout(fn, 150);
}

let bootstrapPromise = null;

function scheduleBootstrap() {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.add('app-booting');
  }

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
