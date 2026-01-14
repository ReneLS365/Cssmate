import assert from 'node:assert/strict'
import test from 'node:test'

function createElement({
  tagName = 'div',
  id = '',
  className = '',
  rect = { top: 0, left: 0, width: 0, height: 0 },
  style = {},
  parentElement = null,
} = {}) {
  return {
    tagName: tagName.toUpperCase(),
    id,
    className,
    parentElement,
    getBoundingClientRect() {
      return rect
    },
    __style: style,
  }
}

function createDocument(elements) {
  return {
    querySelectorAll() {
      return elements
    },
  }
}

function createWindow({ width = 1000, height = 800 } = {}) {
  return {
    innerWidth: width,
    innerHeight: height,
    getComputedStyle(element) {
      return element.__style
    },
  }
}

test('diagnoseInputBlockers detects transparent full-screen overlays', async () => {
  const { diagnoseInputBlockers } = await import('../src/dev/tab-diagnostics.js')

  const overlay = createElement({
    tagName: 'div',
    id: 'overlay',
    rect: { top: 0, left: 0, width: 900, height: 700 },
    style: {
      position: 'fixed',
      pointerEvents: 'auto',
      zIndex: '999',
      opacity: '0',
      visibility: 'visible',
    },
  })

  const safe = createElement({
    tagName: 'div',
    id: 'safe',
    rect: { top: 0, left: 0, width: 200, height: 200 },
    style: {
      position: 'fixed',
      pointerEvents: 'auto',
      zIndex: '999',
      opacity: '0',
      visibility: 'visible',
    },
  })

  const blockers = diagnoseInputBlockers({
    documentRef: createDocument([overlay, safe]),
    windowRef: createWindow(),
  })

  assert.equal(blockers.length, 1)
  assert.equal(blockers[0].path.includes('#overlay'), true)
})

test('diagnoseInputBlockers ignores non-blocking elements', async () => {
  const { diagnoseInputBlockers } = await import('../src/dev/tab-diagnostics.js')

  const overlay = createElement({
    tagName: 'div',
    id: 'overlay',
    rect: { top: 0, left: 0, width: 900, height: 700 },
    style: {
      position: 'fixed',
      pointerEvents: 'none',
      zIndex: '999',
      opacity: '0',
      visibility: 'visible',
    },
  })

  const blockers = diagnoseInputBlockers({
    documentRef: createDocument([overlay]),
    windowRef: createWindow(),
  })

  assert.equal(blockers.length, 0)
})
