import { createNumpadController } from './numpad.js';

const INPUT_SELECTOR = 'input[data-numpad], input[data-numpad-field], input[data-numpad=true], input.mat-qty, textarea[data-numpad]';

function shouldIgnoreEvent(event) {
  if (!event || !event.target) return true;
  if (document.body.dataset.numpadClosing === '1') return true;
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
    return true;
  }
  const disabled = target.hasAttribute('disabled') || target.hasAttribute('readonly');
  if (disabled) return true;
  return !target.matches(INPUT_SELECTOR);
}

let installed = false;

export function installNumpad() {
  if (installed) return;
  installed = true;
  const controller = createNumpadController();

  const openFor = input => {
    if (!input) return;
    if (controller.isOpen() && controller.getActiveInput?.() === input) return;
    controller.open(input);
  };

  document.addEventListener('focusin', event => {
    if (shouldIgnoreEvent(event)) return;
    openFor(event.target);
  });

  document.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (controller.isOpen()) return;
    if (target.matches(`${INPUT_SELECTOR}, ${INPUT_SELECTOR} *`)) {
      const input = target.closest('input, textarea');
      if (input && !shouldIgnoreEvent({ target: input })) {
        openFor(input);
      }
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && controller.isOpen()) {
      controller.close('none');
    }
  });
}
