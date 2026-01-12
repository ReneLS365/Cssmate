import { initAuthProvider } from './auth-provider.js'
import { getAuthDiagnostics, waitForAuthReady } from '../../js/shared-auth.js'
import { initAuthSession, onChange as onSessionChange, getState as getSessionState, SESSION_STATUS } from './session.js'
import { isLighthouseMode } from '../config/lighthouse-mode.js'
import { hardRepairClient } from '../utils/reset-app.js'
import { updateAuthGateReason } from '../state/debug.js'

let gate
let loadingScreen
let loginScreen
let verifyScreen
let messageEl
let loginButton
let logoutButton
let repairButton
let authProvider
let isSubmitting = false

function shouldShowRepair (message, errorCode, variant) {
  if (variant !== 'error') return false
  const combined = `${message || ''} ${errorCode || ''}`.toLowerCase()
  return combined.includes('auth/api-key-expired') ||
    combined.includes('auth/internal-error') ||
    combined.includes('auth/invalid-api-key') ||
    combined.includes('config-fetch') ||
    combined.includes('config-timeout')
}

function setRepairVisible (visible) {
  if (!repairButton) return
  if (visible) {
    repairButton.removeAttribute('hidden')
  } else {
    repairButton.setAttribute('hidden', '')
  }
}

function setMessage (text, variant = '', errorCode = '') {
  if (!messageEl) return
  messageEl.textContent = text || ''
  messageEl.dataset.variant = variant || ''
  setRepairVisible(shouldShowRepair(text, errorCode, variant))
}

function showSection (section) {
  if (!gate) return
  loadingScreen?.setAttribute('hidden', '')
  loginScreen?.setAttribute('hidden', '')
  verifyScreen?.setAttribute('hidden', '')
  if (section === 'loading') loadingScreen?.removeAttribute('hidden')
  if (section === 'login') loginScreen?.removeAttribute('hidden')
  if (section === 'verify') verifyScreen?.removeAttribute('hidden')
  if (gate?.toggleAttribute) {
    gate.toggleAttribute('data-locked', section !== 'hidden')
  } else if (gate?.setAttribute) {
    if (section !== 'hidden') {
      gate.setAttribute('data-locked', 'true')
    } else {
      gate.removeAttribute('data-locked')
    }
  }
  document.documentElement.classList.toggle('auth-locked', section !== 'hidden')
}

function setGateVisible (visible) {
  if (!gate) return
  if (visible) {
    gate.removeAttribute('hidden')
    document.body?.classList?.add('auth-overlay-open')
  } else {
    gate.setAttribute('hidden', '')
    document.body?.classList?.remove('auth-overlay-open')
    setMessage('')
  }
}

function disableForm (disabled) {
  isSubmitting = disabled
  ;[
    loginButton,
    logoutButton,
    repairButton,
  ].forEach((btn) => {
    if (btn) btn.disabled = disabled
  })
}

async function handleAuthAction (fn, successMessage) {
  if (isSubmitting) return
  try {
    disableForm(true)
    setMessage('')
    await fn()
    if (successMessage) setMessage(successMessage, 'success')
  } catch (error) {
    console.warn('Auth action fejlede', error)
    setMessage(error?.message || 'Kunne ikke udføre handlingen', 'error', error?.code || '')
  } finally {
    disableForm(false)
  }
}

function bindLoginHandlers () {
  if (loginButton) {
    loginButton.addEventListener('click', async () => {
      await handleAuthAction(() => authProvider.actions.signInWithRedirect(), 'Sender dig til login…')
    })
  }
  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      await handleAuthAction(() => authProvider.actions.signOut(), 'Logget ud')
    })
  }
}

function handleAuthChange (state) {
  const status = state?.status || SESSION_STATUS.SIGNING_IN
  const authReady = Boolean(state?.authReady)
  const requiresVerification = Boolean(state?.requiresVerification)
  const hasUser = Boolean(state?.user)
  const message = state?.message || (status === SESSION_STATUS.NO_ACCESS ? 'Ingen adgang til teamet.' : '')
  const authErrorCode = state?.error?.code || getAuthDiagnostics()?.lastAuthErrorCode || ''
  const hasAuthError = Boolean(state?.error)

  if (!authReady) {
    setGateVisible(true)
    showSection('loading')
    updateAuthGateReason('auth-waiting')
    setMessage(state?.message || 'Login initialiseres…', '', authErrorCode)
    return
  }

  if (hasUser && authReady && !requiresVerification) {
    showSection('hidden')
    setGateVisible(false)
    setMessage('')
    updateAuthGateReason('')
    return
  }

  if (!hasUser) {
    setGateVisible(true)
    showSection('login')
    const variant = status === SESSION_STATUS.NO_ACCESS || status === SESSION_STATUS.ERROR || hasAuthError ? 'error' : ''
    setMessage(message || 'Log ind for at fortsætte', variant, authErrorCode)
    updateAuthGateReason(status === SESSION_STATUS.NO_ACCESS ? 'no-access' : (hasAuthError ? 'auth-error' : 'signed-out'))
    return
  }

  if (requiresVerification) {
    setGateVisible(true)
    showSection('login')
    setMessage('Log ind for at fortsætte.', '', authErrorCode)
    updateAuthGateReason('signed-out')
    return
  }
}

export function initAuthGate () {
  if (isLighthouseMode()) {
    gate = document.getElementById('authGate')
    if (gate) {
      gate.setAttribute('hidden', '')
    }
    document.documentElement.classList.remove('auth-locked')
    document.body?.classList?.remove('auth-overlay-open')
    return {
      waitForVerifiedAccess: () => Promise.resolve(),
      waitForSessionReady: () => Promise.resolve(),
      waitForAuthReady: () => Promise.resolve(),
      prefetchAuth: () => Promise.resolve(),
    }
  }
  if (gate) {
    const waitForAuth = () => (authProvider?.ensureAuth ? authProvider.ensureAuth() : waitForAuthReady())
    return {
      waitForVerifiedAccess: () => waitForAuth(),
      waitForSessionReady: () => waitForAuth(),
      waitForAuthReady: () => waitForAuth(),
      prefetchAuth: () => authProvider?.prefetchAuth?.(),
    }
  }

  gate = document.getElementById('authGate')
  loadingScreen = document.getElementById('authLoadingScreen')
  loginScreen = document.getElementById('authLoginScreen')
  verifyScreen = document.getElementById('authVerifyScreen')
  messageEl = document.getElementById('authMessage')
  loginButton = document.getElementById('authLogin')
  logoutButton = document.getElementById('authLogout')
  repairButton = document.getElementById('authRepair')

  if (!gate || typeof gate.setAttribute !== 'function') {
    console.warn('AuthGate markup mangler')
    return {
      waitForVerifiedAccess: () => Promise.resolve(),
      waitForAuthReady: () => waitForAuthReady(),
    }
  }

  authProvider = initAuthProvider()
  bindLoginHandlers()
  if (repairButton) {
    repairButton.addEventListener('click', () => {
      if (isSubmitting) return
      hardRepairClient()
    })
  }
  initAuthSession()
  onSessionChange(handleAuthChange)
  handleAuthChange(getSessionState())

  const waitForAuth = () => {
    if (authProvider?.ensureAuth) return authProvider.ensureAuth()
    return waitForAuthReady()
  }

  return {
    waitForVerifiedAccess: () => waitForAuth(),
    waitForSessionReady: () => waitForAuth(),
    waitForAuthReady: () => waitForAuth(),
    prefetchAuth: () => authProvider?.prefetchAuth?.(),
  }
}
