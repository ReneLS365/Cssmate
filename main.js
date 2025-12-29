function runWhenIdle(fn) {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(fn, { timeout: 1500 });
    return;
  }
  setTimeout(fn, 150);
}

function scheduleBootstrap() {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.add('app-booting');
  }

  const start = () => {
    runWhenIdle(() => {
      import('./app-main.js')
        .then(mod => mod?.bootstrapApp?.())
        .catch(error => {
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
