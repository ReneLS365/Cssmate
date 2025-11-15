let installerPromise = null;
let installed = false;

export async function installLazyNumpad() {
  if (installed) return;
  if (installerPromise) {
    await installerPromise;
    return;
  }
  installerPromise = import('./numpad.init.js')
    .then(module => {
      if (typeof module?.installNumpad === 'function') {
        module.installNumpad();
      }
      installed = true;
    })
    .finally(() => {
      installerPromise = null;
    });
  await installerPromise;
}
