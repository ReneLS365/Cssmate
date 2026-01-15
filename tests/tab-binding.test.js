import assert from 'node:assert/strict'
import test from 'node:test'

function createClassList(initial = []) {
  const items = new Set(initial)
  return {
    add: (cls) => items.add(cls),
    remove: (cls) => items.delete(cls),
    toggle: (cls, force) => {
      if (force === undefined) {
        if (items.has(cls)) {
          items.delete(cls)
          return false
        }
        items.add(cls)
        return true
      }
      if (force) {
        items.add(cls)
      } else {
        items.delete(cls)
      }
      return force
    },
    contains: (cls) => items.has(cls),
  }
}

function createElement({ role, tabId, panelId, selected = false } = {}) {
  const listeners = new Map()
  const attributes = new Map()
  if (role) attributes.set('role', role)
  if (selected) attributes.set('aria-selected', 'true')

  const element = {
    dataset: {},
    classList: createClassList(),
    hidden: false,
    tabIndex: 0,
    addEventListener: (type, handler) => {
      const existing = listeners.get(type) || []
      existing.push(handler)
      listeners.set(type, existing)
    },
    dispatchEvent: () => true,
    focus: () => {},
    getAttribute: (key) => attributes.get(key),
    hasAttribute: (key) => attributes.has(key),
    setAttribute: (key, value) => {
      attributes.set(key, value)
      if (key === 'hidden') element.hidden = true
    },
    removeAttribute: (key) => {
      attributes.delete(key)
      if (key === 'hidden') element.hidden = false
    },
    __listeners: listeners,
  }

  if (tabId) element.dataset.tabId = tabId
  if (panelId) element.dataset.tabPanel = panelId

  return element
}

test('tab bindings switch active panel on click', async () => {
  const originalWindow = global.window
  const originalDocument = global.document
  const originalCustomEvent = global.CustomEvent

  const tabOne = createElement({ role: 'tab', tabId: 'sagsinfo', selected: true })
  const tabTwo = createElement({ role: 'tab', tabId: 'historik' })
  tabOne.setAttribute('aria-selected', 'true')
  tabTwo.setAttribute('aria-selected', 'false')

  const panelOne = createElement({ role: 'tabpanel', panelId: 'sagsinfo' })
  const panelTwo = createElement({ role: 'tabpanel', panelId: 'historik' })
  panelTwo.setAttribute('hidden', '')

  global.window = {
    localStorage: {
      _store: {},
      getItem(key) {
        return this._store[key] || null
      },
      setItem(key, value) {
        this._store[key] = String(value)
      },
    },
  }

  global.CustomEvent = class {
    constructor(type, detail) {
      this.type = type
      this.detail = detail
    }
  }

  global.document = {
    querySelectorAll: (selector) => {
      if (selector === '[role="tab"][data-tab-id]') return [tabOne, tabTwo]
      if (selector === '[role="tabpanel"][data-tab-panel]') return [panelOne, panelTwo]
      return []
    },
    dispatchEvent: () => true,
  }

  const { ensureTabsBound } = await import('../app-main.js')
  const bound = ensureTabsBound()
  assert.equal(bound, true)

  const clickHandlers = tabTwo.__listeners.get('click') || []
  assert.equal(clickHandlers.length > 0, true)
  clickHandlers.forEach(handler => handler())

  assert.equal(tabOne.getAttribute('aria-selected'), 'false')
  assert.equal(tabTwo.getAttribute('aria-selected'), 'true')
  assert.equal(panelOne.hidden, true)
  assert.equal(panelTwo.hidden, false)

  global.window = originalWindow
  global.document = originalDocument
  global.CustomEvent = originalCustomEvent
})
