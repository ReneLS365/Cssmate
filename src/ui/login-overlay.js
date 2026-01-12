import { isAuthenticated, login } from '../auth/auth0-client.js'

const OVERLAY_ID = 'cssmate-login-overlay'
const STYLE_ID = 'cssmate-login-overlay-style'
const MESSAGE_ID = 'cssmate-login-overlay-message'
const ERROR_ID = 'cssmate-login-overlay-error'
const BUTTON_ID = 'cssmate-login-overlay-button'
const DEFAULT_MESSAGE = 'Log ind for at fortsætte.'
const DEFAULT_ERROR = 'Login fejlede. Prøv igen.'

let overlayNodes = null
let authWatchTimer = null

function setHidden (element, hidden) {
  if (!element) return
  element.hidden = hidden
  if (hidden) {
    element.setAttribute('aria-hidden', 'true')
  } else {
    element.removeAttribute('aria-hidden')
  }
}

function setText (element, value) {
  if (!element) return
  element.textContent = value
}

function ensureOverlayStyles () {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return

  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    #${OVERLAY_ID} {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      background: rgba(7, 10, 18, 0.6);
    }
    #${OVERLAY_ID}[hidden] {
      display: none;
    }
    #${OVERLAY_ID} .cssmate-login-overlay__panel {
      width: 100%;
      max-width: 420px;
      background: #fff;
      color: #111;
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.25);
      text-align: center;
    }
    #${OVERLAY_ID} .cssmate-login-overlay__title {
      margin: 0 0 8px;
      font-size: 18px;
    }
    #${OVERLAY_ID} .cssmate-login-overlay__message {
      margin: 0 0 12px;
      font-size: 14px;
    }
    #${OVERLAY_ID} .cssmate-login-overlay__error {
      margin: 0 0 12px;
      font-size: 14px;
      font-weight: 600;
      color: #b00020;
    }
    #${OVERLAY_ID} .cssmate-login-overlay__button {
      min-height: 44px;
      padding: 10px 16px;
      font-size: 16px;
      border-radius: 8px;
      border: none;
      background: #1f6feb;
      color: #fff;
      cursor: pointer;
    }
  `
  document.head?.appendChild(style)
}

function buildOverlay () {
  if (typeof document === 'undefined') return null
  ensureOverlayStyles()

  const container = document.createElement('div')
  container.id = OVERLAY_ID
  container.setAttribute('aria-hidden', 'true')
  container.hidden = true

  const panel = document.createElement('div')
  panel.className = 'cssmate-login-overlay__panel'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'true')
  panel.setAttribute('aria-labelledby', `${OVERLAY_ID}-title`)

  const title = document.createElement('h2')
  title.id = `${OVERLAY_ID}-title`
  title.className = 'cssmate-login-overlay__title'
  title.textContent = 'Log ind'

  const message = document.createElement('p')
  message.id = MESSAGE_ID
  message.className = 'cssmate-login-overlay__message'
  message.textContent = DEFAULT_MESSAGE

  const error = document.createElement('p')
  error.id = ERROR_ID
  error.className = 'cssmate-login-overlay__error'
  error.setAttribute('aria-live', 'polite')
  error.hidden = true

  const button = document.createElement('button')
  button.id = BUTTON_ID
  button.type = 'button'
  button.className = 'cssmate-login-overlay__button'
  button.textContent = 'Log ind'
  button.addEventListener('click', () => {
    login().catch(loginError => {
      console.warn('Login redirect failed', loginError)
      showLoginOverlay({ error: loginError?.message || DEFAULT_ERROR })
    })
  })

  panel.append(title, message, error, button)
  container.append(panel)
  document.body?.appendChild(container)

  return {
    container,
    message,
    error,
    button,
  }
}

function ensureOverlay () {
  if (typeof document === 'undefined') return null
  if (overlayNodes?.container?.isConnected) return overlayNodes
  const existing = document.getElementById(OVERLAY_ID)
  if (existing) {
    overlayNodes = {
      container: existing,
      message: existing.querySelector(`#${MESSAGE_ID}`),
      error: existing.querySelector(`#${ERROR_ID}`),
      button: existing.querySelector(`#${BUTTON_ID}`),
    }
    return overlayNodes
  }
  overlayNodes = buildOverlay()
  return overlayNodes
}

export function showLoginOverlay ({ message, error } = {}) {
  const nodes = ensureOverlay()
  if (!nodes) return
  const messageValue = typeof message === 'string' && message.trim() ? message : DEFAULT_MESSAGE
  setText(nodes.message, messageValue)
  if (error) {
    setText(nodes.error, error)
    setHidden(nodes.error, false)
  } else {
    setText(nodes.error, '')
    setHidden(nodes.error, true)
  }
  setHidden(nodes.container, false)
}

export function hideLoginOverlay () {
  const nodes = ensureOverlay()
  if (!nodes) return
  setHidden(nodes.container, true)
}

async function checkAuthAndHide () {
  try {
    const ok = await isAuthenticated()
    if (ok) {
      hideLoginOverlay()
      stopLoginOverlayWatcher()
    }
  } catch {
    // ignore auth errors during polling
  }
}

export function startLoginOverlayWatcher () {
  if (typeof window === 'undefined') return
  if (authWatchTimer) return
  authWatchTimer = window.setInterval(() => {
    checkAuthAndHide()
  }, 1500)
}

export function stopLoginOverlayWatcher () {
  if (!authWatchTimer) return
  window.clearInterval(authWatchTimer)
  authWatchTimer = null
}
