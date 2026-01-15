import assert from 'node:assert/strict'
import test from 'node:test'

test('ensureUiInteractive disables transparent blockers', async () => {
  const originalWindow = global.window
  const originalDocument = global.document

  const createClassList = (initial = []) => {
    const items = new Set(initial)
    return {
      add: (cls) => items.add(cls),
      remove: (cls) => items.delete(cls),
      contains: (cls) => items.has(cls),
    }
  }

  const createElement = ({ id = '', rect, style = {} } = {}) => {
    const attributes = new Map()
    const element = {
      id,
      style: { ...style },
      dataset: {},
      classList: createClassList(),
      getBoundingClientRect() {
        return rect
      },
      setAttribute(key, value) {
        attributes.set(key, value)
      },
      getAttribute(key) {
        return attributes.get(key)
      },
    }
    return element
  }

  const overlay = createElement({
    id: 'overlay',
    rect: { top: 0, left: 0, width: 900, height: 700 },
    style: {
      position: 'fixed',
      pointerEvents: 'auto',
      zIndex: '999',
      opacity: '0',
      visibility: 'visible',
      display: 'block',
    },
  })

  const appRoot = {
    removeAttribute() {},
  }

  global.window = {
    innerWidth: 1000,
    innerHeight: 800,
    getComputedStyle: (element) => element.style,
  }

  global.document = {
    documentElement: { classList: createClassList(['auth-locked']) },
    body: { classList: createClassList(['auth-overlay-open']) },
    querySelectorAll: () => [overlay],
    querySelector: () => null,
    getElementById: (id) => (id === 'app' ? appRoot : null),
  }

  const { ensureUiInteractive } = await import('../src/ui/guards/ui-unlock.js')
  ensureUiInteractive('test-unlock')

  assert.equal(overlay.style.pointerEvents, 'none')
  assert.equal(overlay.style.display, 'none')
  assert.equal(overlay.getAttribute('data-auto-disabled'), 'test-unlock')

  global.window = originalWindow
  global.document = originalDocument
})
