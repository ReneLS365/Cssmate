let toastRoot

function ensureToastRoot () {
  if (typeof document === 'undefined') return null
  if (toastRoot && document.body?.contains?.(toastRoot)) return toastRoot
  toastRoot = document.createElement('div')
  toastRoot.className = 'toast-stack'
  toastRoot.setAttribute('aria-live', 'polite')
  toastRoot.setAttribute('aria-atomic', 'true')
  document.body?.appendChild?.(toastRoot)
  return toastRoot
}

export function showToast (message, options = {}) {
  if (!message) return null
  const root = ensureToastRoot()
  if (!root) return null
  const {
    variant = 'info',
    duration = 4200,
    actionLabel,
    onAction,
  } = options

  const toast = document.createElement('div')
  toast.className = `toast toast--${variant}`

  const content = document.createElement('div')
  content.className = 'toast__content'
  const text = document.createElement('div')
  text.textContent = message
  content.appendChild(text)

  if (actionLabel) {
    const actions = document.createElement('div')
    actions.className = 'toast__actions'
    const actionBtn = document.createElement('button')
    actionBtn.type = 'button'
    actionBtn.textContent = actionLabel
    actionBtn.addEventListener('click', () => {
      if (typeof onAction === 'function') onAction()
      dismiss()
    })
    actions.appendChild(actionBtn)
    content.appendChild(actions)
  }

  toast.appendChild(content)
  root.appendChild(toast)

  let timeoutId = null
  const setTimer = typeof window !== 'undefined' && typeof window.setTimeout === 'function'
    ? window.setTimeout
    : setTimeout
  const clearTimer = typeof window !== 'undefined' && typeof window.clearTimeout === 'function'
    ? window.clearTimeout
    : clearTimeout
  const dismiss = () => {
    if (timeoutId) clearTimer(timeoutId)
    toast.remove()
  }

  if (duration > 0) {
    timeoutId = setTimer(dismiss, duration)
  }

  return { dismiss }
}
