const MAX_EVENTS = 20
const BLOCKER_THRESHOLD = 0.8
const BLOCKER_Z_INDEX = 100

function isTabDiagnosticsEnabled () {
  const devFlag = Boolean(typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV)
  if (typeof window === 'undefined') return devFlag
  return devFlag || Boolean(window.__TAB_DEBUG__)
}

function buildElementPath (element) {
  if (!element || typeof element !== 'object') return ''
  const parts = []
  let current = element
  for (let depth = 0; current && depth < 4; depth += 1) {
    const tag = current.tagName ? current.tagName.toLowerCase() : 'node'
    const id = current.id ? `#${current.id}` : ''
    const classList = typeof current.className === 'string'
      ? current.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(cls => `.${cls}`).join('')
      : ''
    parts.unshift(`${tag}${id}${classList}`)
    current = current.parentElement
  }
  return parts.join(' > ')
}

function normalizeZIndex (value) {
  const numeric = Number.parseInt(String(value || '0'), 10)
  return Number.isFinite(numeric) ? numeric : 0
}

function isElementCandidate (element) {
  return Boolean(element && typeof element.getBoundingClientRect === 'function')
}

export function diagnoseInputBlockers ({ documentRef = document, windowRef = window, getComputedStyleFn = null } = {}) {
  if (!documentRef || !windowRef) return []
  const getStyle = getComputedStyleFn || ((element) => windowRef.getComputedStyle(element))
  const viewportWidth = windowRef.innerWidth || 0
  const viewportHeight = windowRef.innerHeight || 0
  if (!viewportWidth || !viewportHeight) return []

  const blockers = []
  const elements = Array.from(documentRef.querySelectorAll('body *'))
  elements.forEach(element => {
    if (!isElementCandidate(element)) return
    const style = getStyle(element)
    if (!style) return
    const position = style.position
    if (position !== 'fixed' && position !== 'absolute') return
    if (style.pointerEvents !== 'auto') return

    const rect = element.getBoundingClientRect()
    if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return
    const coversWidth = rect.width >= viewportWidth * BLOCKER_THRESHOLD
    const coversHeight = rect.height >= viewportHeight * BLOCKER_THRESHOLD
    if (!coversWidth || !coversHeight) return

    const zIndex = normalizeZIndex(style.zIndex)
    if (zIndex < BLOCKER_Z_INDEX) return

    const opacity = Number.parseFloat(style.opacity || '1')
    const visibility = style.visibility
    const transparent = Number.isFinite(opacity) ? opacity <= 0.05 : false
    const visuallyHidden = transparent || visibility === 'hidden'
    if (!visuallyHidden) return

    blockers.push({
      path: buildElementPath(element),
      rect: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      },
      styles: {
        position,
        zIndex,
        pointerEvents: style.pointerEvents,
        opacity: style.opacity,
        visibility,
      },
    })
  })

  return blockers
}

function snapshotTabButton (button) {
  if (!button) return null
  const rect = button.getBoundingClientRect()
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  const topElement = document.elementFromPoint(centerX, centerY)
  return {
    id: button.dataset?.tabId || '',
    label: button.textContent?.trim() || '',
    ariaSelected: button.getAttribute('aria-selected') || '',
    disabled: button.hasAttribute('disabled'),
    hasClickHandler: button.dataset?.tabBound === '1',
    center: {
      x: Math.round(centerX),
      y: Math.round(centerY),
    },
    topElement: buildElementPath(topElement),
  }
}

export function initTabDiagnostics () {
  if (!isTabDiagnosticsEnabled()) return null
  if (typeof window === 'undefined' || typeof document === 'undefined') return null
  if (window.__tabDebug?.snapshot) return window.__tabDebug

  const state = {
    events: [],
    bindings: {},
    blockers: [],
    lastClick: null,
  }

  let pendingPointerDown = null

  function recordEvent (entry) {
    state.events.push(entry)
    if (state.events.length > MAX_EVENTS) {
      state.events.splice(0, state.events.length - MAX_EVENTS)
    }
  }

  function handlePointerDown (event) {
    const target = event.target
    const tabBar = target instanceof Element ? target.closest('[role="tablist"]') : null
    const entry = {
      time: Date.now(),
      target: buildElementPath(target),
      defaultPrevented: Boolean(event.defaultPrevented),
      pointerType: event.pointerType || 'unknown',
      inTabBar: Boolean(tabBar),
      missedTabHandler: false,
    }
    recordEvent(entry)

    if (tabBar) {
      pendingPointerDown = { entry, time: Date.now() }
      setTimeout(() => {
        if (pendingPointerDown?.entry === entry && !entry.missedTabHandler) {
          entry.missedTabHandler = true
        }
        if (pendingPointerDown?.entry === entry) {
          pendingPointerDown = null
        }
      }, 150)
    }
  }

  document.addEventListener('pointerdown', handlePointerDown, { capture: true })

  function registerTabBinding (tabId, button) {
    if (!tabId) return
    state.bindings[tabId] = {
      hasClickHandler: true,
      boundAt: Date.now(),
      element: buildElementPath(button),
    }
  }

  function onTabClick (tabId) {
    state.lastClick = { tabId, time: Date.now() }
    if (pendingPointerDown) {
      pendingPointerDown.entry.missedTabHandler = false
      pendingPointerDown = null
    }
  }

  function setActiveTab (tabId) {
    state.activeTab = tabId
  }

  function snapshot () {
    const tabButtons = Array.from(document.querySelectorAll('[role="tab"][data-tab-id]'))
    const tabIds = tabButtons.map(button => button.dataset?.tabId).filter(Boolean)
    const activeButton = tabButtons.find(button => button.getAttribute('aria-selected') === 'true')
    const appRoot = document.getElementById('app')
    const tabBar = document.querySelector('[role="tablist"]')
    const appPointer = appRoot ? window.getComputedStyle(appRoot).pointerEvents : 'unknown'
    const tabPointer = tabBar ? window.getComputedStyle(tabBar).pointerEvents : 'unknown'

    state.blockers = diagnoseInputBlockers()

    return {
      tabCount: tabButtons.length,
      tabIds,
      activeTab: state.activeTab || activeButton?.dataset?.tabId || '',
      route: {
        pathname: window.location?.pathname || '',
        search: window.location?.search || '',
        hash: window.location?.hash || '',
      },
      pointerEvents: {
        appRoot: appPointer,
        tabBar: tabPointer,
      },
      tabs: tabButtons.map(snapshotTabButton).filter(Boolean),
      bindings: { ...state.bindings },
      blockers: [...state.blockers],
      lastClick: state.lastClick,
      events: [...state.events],
    }
  }

  window.__tabDebug = {
    snapshot,
    registerTabBinding,
    onTabClick,
    setActiveTab,
    events: state.events,
    bindings: state.bindings,
    blockers: state.blockers,
    lastClick: state.lastClick,
  }

  return window.__tabDebug
}
