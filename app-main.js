import { initMaterialsScrollLock } from './src/modules/materialsscrolllock.js'
import { calculateTotals } from './src/modules/calculatetotals.js'
import { normalizeKey } from './src/lib/string-utils.js'
import { EXCLUDED_MATERIAL_KEYS, shouldExcludeMaterialEntry } from './src/lib/materials/exclusions.js'
import { mergeExtrasKm, resolveKmInputValue } from './src/lib/extras-helpers.js'
import { createMaterialRow } from './src/modules/materialrowtemplate.js'
import { sha256Hex, constantTimeEquals } from './src/lib/sha256.js'
import { setupNumpad } from './js/numpad.js'
import { exportMeta, setSlaebFormulaText } from './js/export-meta.js'
import { buildAkkordData as buildSharedAkkordData } from './js/akkord-data.js'
import { buildExportModel as buildSharedExportModel } from './js/export-model.js'
import { initClickGuard } from './src/ui/guards/clickguard.js'
import { setAdminOk, restoreAdminState, isAdminUnlocked } from './src/state/admin.js'
import { shouldSkipAuthGate } from './src/auth/skip-auth-gate.js'
import { setActiveJob } from './src/state/jobs.js'
import { saveDraft, loadDraft, clearDraft } from './js/storageDraft.js'
import { appendHistoryEntry, loadHistory as loadHistoryEntries, deleteHistoryEntry, migrateHistory, buildHistoryKey as computeHistoryKey } from './js/storageHistory.js'
import { normalizeHistoryEntry as baseNormalizeHistoryEntry, normalizeHistoryList, formatDateLabel, normalizeSearchValue } from './js/history-normalizer.js'
import { downloadBlob } from './js/utils/downloadBlob.js'
import { applyBuildMetadata, isDebugOverlayEnabled, updateCurrentView } from './src/state/debug.js'
import { resetAppState, resetOfflineCache } from './src/utils/reset-app.js'
import { initBootInline } from './boot-inline.js'
import { isAutomated, isCi, isLighthouse } from './src/config/runtime-modes.js'
import { isDiagnosticsEnabled, mountDiagnostics } from './src/ui/auth-diagnostics.js'
import { initAuth0Ui } from './src/auth/auth0-ui.js'
import { getClient as getAuth0Client, getUser, isAuthenticated, login, signup } from './src/auth/auth0-client.js'
import { forceLoginOnce } from './src/auth/force-login.js'

function readCiFlag () {
  if (typeof document !== 'undefined') {
    const meta = document.querySelector('meta[name="cssmate-is-ci"]')
    if (meta?.getAttribute('content') === '1') return true
  }
  return typeof window !== 'undefined' && window.CSSMATE_IS_CI === true
}

let IS_CI = false
let IS_LIGHTHOUSE = false
let IS_AUTOMATED = false
const INVITE_TOKEN_KEY = 'cssmate:inviteToken'
const INVITE_NOTICE_KEY = 'cssmate:inviteNoticeShown'

function isDevBuild () {
  try {
    return Boolean(typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV)
  } catch (error) {
    return false
  }
}

if (isDevBuild()) {
  console.log('[auth:diagnostics]', 'auth bootstrap enabled')
}

function setupServiceWorkerAutoReload () {
  if (typeof window === 'undefined') return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  const RELOAD_KEY = 'cssmate_sw_reloaded'
  let hasReloaded = false

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hasReloaded) return

    try {
      if (window.sessionStorage?.getItem(RELOAD_KEY) === '1') {
        return
      }
      window.sessionStorage?.setItem(RELOAD_KEY, '1')
    } catch (error) {
      // Ignore storage errors to avoid blocking reload
    }

    hasReloaded = true
    window.location.reload()
  })

  window.addEventListener('load', () => {
    setTimeout(() => {
      try {
        window.sessionStorage?.removeItem(RELOAD_KEY)
      } catch (error) {
        // Ignore storage errors to avoid console noise
      }
    }, 1000)
  })
}


function getCurrentAppVersion () {
  if (typeof window !== 'undefined' && typeof window.CSSMATE_APP_VERSION === 'string') {
    return window.CSSMATE_APP_VERSION
  }

  if (typeof self !== 'undefined' && typeof self.CSSMATE_APP_VERSION === 'string') {
    return self.CSSMATE_APP_VERSION
  }

  return 'dev'
}

function showUpdateBanner (currentVersion, previousVersion) {
  if (typeof document === 'undefined') return
  if (typeof navigator !== 'undefined' && navigator.webdriver) return
  if (document.getElementById('cssmate-update-banner')) return

  const banner = document.createElement('div')
  banner.id = 'cssmate-update-banner'
  banner.style.position = 'fixed'
  banner.style.left = '0'
  banner.style.right = '0'
  banner.style.bottom = '0'
  banner.style.zIndex = '9999'
  banner.style.padding = '8px 12px'
  banner.style.fontSize = '12px'
  banner.style.display = 'flex'
  banner.style.justifyContent = 'space-between'
  banner.style.alignItems = 'center'
  banner.style.background = '#222'
  banner.style.color = '#fff'

  banner.innerHTML = `
    <span>Ny version af Cssmate er klar (fra ${previousVersion} til ${currentVersion}).</span>
    <button type="button" id="cssmate-update-btn">Opdater nu</button>
  `

  if (!document.body) {
    return
  }

  document.body.appendChild(banner)

  const btn = document.getElementById('cssmate-update-btn')
  if (btn) {
    btn.style.marginLeft = '12px'
    btn.style.padding = '4px 10px'
    btn.style.fontSize = '12px'
    btn.style.cursor = 'pointer'

    btn.addEventListener('click', () => {
      if (typeof window === 'undefined') {
        return
      }

      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(regs => {
          return Promise.all(regs.map(reg => reg.update()))
        }).finally(() => {
          window.location.reload(true)
        })
      } else {
        window.location.reload(true)
      }
    })
  }
}

function maybeShowInviteNotice () {
  if (typeof window === 'undefined') return
  let token = ''
  let noticeShown = ''
  try {
    token = window.sessionStorage?.getItem(INVITE_TOKEN_KEY) || ''
    noticeShown = window.sessionStorage?.getItem(INVITE_NOTICE_KEY) || ''
  } catch {
    token = ''
    noticeShown = ''
  }
  if (!token || noticeShown === '1') return
  updateActionHint('Invitation registreret. Åbn Team for at fuldføre.', 'success')
  try {
    window.sessionStorage?.setItem(INVITE_NOTICE_KEY, '1')
  } catch {
    // ignore
  }
}

function setupVersionCheck () {
  if (typeof window === 'undefined') return

  const version = getCurrentAppVersion()
  const STORAGE_KEY = 'cssmate_app_version'

  try {
    const storage = window.localStorage
    if (!storage) return

    const previous = storage.getItem(STORAGE_KEY)

    if (previous && previous !== version) {
      showUpdateBanner(version, previous)
    }

    storage.setItem(STORAGE_KEY, version)
  } catch (error) {
    console.warn('Unable to access localStorage for version check', error)
  }
}

function runWhenIdle (fn) {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(fn, { timeout: 1500 })
    return
  }
  setTimeout(fn, 150)
}

let authGateModulePromise = null
let authProviderModulePromise = null
let appGuardModulePromise = null
let debugOverlayModulePromise = null
let authBootstrapModulePromise = null
let authProviderSubscribed = false
let cachedAuthIdentity = null

function ensureAuthGateModule () {
  if (!authGateModulePromise) {
    authGateModulePromise = import('./src/auth/auth-gate.js')
  }
  return authGateModulePromise
}

function ensureAuthProviderModule () {
  if (!authProviderModulePromise) {
    authProviderModulePromise = import('./src/auth/auth-provider.js')
  }
  return authProviderModulePromise
}

function ensureAppGuardModule () {
  if (!appGuardModulePromise) {
    appGuardModulePromise = import('./src/ui/app-guard.js')
  }
  return appGuardModulePromise
}

function ensureDebugOverlayModule () {
  if (!debugOverlayModulePromise) {
    debugOverlayModulePromise = import('./src/debug/tools.js')
  }
  return debugOverlayModulePromise
}

function ensureAuthBootstrapModule () {
  if (!authBootstrapModulePromise) {
    authBootstrapModulePromise = import('./src/auth/bootstrap.js')
  }
  return authBootstrapModulePromise
}

async function initAuthGateLazy () {
  const mod = await ensureAuthGateModule()
  return mod?.initAuthGate?.()
}

function warmupAuthProvider () {
  return ensureAuthProviderModule()
    .then(mod => {
      cachedAuthIdentity = mod?.getAuthIdentity?.() || cachedAuthIdentity
      if (!authProviderSubscribed && typeof mod?.onChange === 'function') {
        authProviderSubscribed = true
        mod.onChange(() => {
          cachedAuthIdentity = mod?.getAuthIdentity?.() || cachedAuthIdentity
        })
      }
      return mod
    })
    .catch(error => {
      console.warn('Kunne ikke indlæse auth-modulet', error)
      authProviderModulePromise = null
      throw error
    })
}

function getCachedAuthIdentity () {
  if (!authProviderModulePromise) {
    runWhenIdle(() => {
      warmupAuthProvider().catch(() => {})
    })
  }
  return cachedAuthIdentity
}

function initDebugOverlayLazy () {
  if (!isDebugOverlayEnabled()) return
  runWhenIdle(() => {
    ensureDebugOverlayModule()
      .then(mod => mod?.initDebugTools?.())
      .catch(error => console.warn('Kunne ikke indlæse debug overlay', error))
  })
}

function initAppGuardLazy () {
  runWhenIdle(() => {
    ensureAppGuardModule()
      .then(mod => mod?.initAppGuard?.())
      .catch(error => console.warn('Kunne ikke indlæse app-guard', error))
  })
}

function ensureSharedCasesPanelLazy () {
  if (!sharedCasesModulePromise) {
    sharedCasesModulePromise = import('./js/shared-cases-panel.js')
  }
  return sharedCasesModulePromise
    .then(mod => {
      mod?.initSharedCasesPanel?.()
      return mod
    })
    .catch(error => {
      console.warn('Kunne ikke indlæse delte sager panelet', error)
      throw error
    })
}

function ensureTeamAdminPageLazy () {
  if (!teamAdminModulePromise) {
    teamAdminModulePromise = import('./src/ui/team-admin-page.js')
  }
  return teamAdminModulePromise
    .then(mod => {
      mod?.initTeamAdminPage?.()
      return mod
    })
    .catch(error => {
      console.warn('Kunne ikke indlæse team-admin siden', error)
      teamAdminModulePromise = null
      throw error
    })
}

async function ensureExportPanelModule () {
  if (exportPanelPromise) return exportPanelPromise

  exportPanelPromise = import('./js/akkord-export-ui.js')
    .then(mod => {
      if (typeof mod?.initExportPanel === 'function') {
        mod.initExportPanel()
      }
      exportPanelReady = true
      return mod
    })
    .catch(error => {
      exportPanelPromise = null
      throw error
    })

  return exportPanelPromise
}

function bindLazyExportAction (elementId, handlerName) {
  const el = typeof document !== 'undefined' ? document.getElementById(elementId) : null
  if (!el) return

  el.addEventListener('click', async event => {
    if (exportPanelReady) return

    event.preventDefault()
    event.stopImmediatePropagation()
    try {
      const mod = await ensureExportPanelModule()
      const handler = mod?.[handlerName]
      if (typeof handler === 'function') {
        handler(event)
      }
    } catch (error) {
      console.error('Eksport-panel kunne ikke indlæses', error)
      updateActionHint('Kunne ikke indlæse eksport-funktionerne. Prøv igen.', 'error')
    }
  }, { capture: true })
}

function setupLazyExportPanelTriggers () {
  if (typeof document === 'undefined') return
  const exportPanel = document.querySelector('.export-panel')
  if (!exportPanel) return

  const warmup = () => {
    ensureExportPanelModule().catch(error => {
      console.warn('Kunne ikke forberede eksportpanelet', error)
    })
    ensureExportLibsLazy()?.catch?.(error => console.warn('Kunne ikke loade eksportlibs', error))
    ensureZipLibLazy()?.catch?.(error => console.warn('Kunne ikke loade ZIP-lib', error))
  }

  ;['pointerenter', 'touchstart', 'focusin'].forEach(eventName => {
    exportPanel.addEventListener(eventName, warmup, {
      once: true,
      passive: eventName === 'touchstart',
    })
  })

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        warmup()
        observer.disconnect()
      }
    }, { rootMargin: '128px' })
    observer.observe(exportPanel)
  }

    bindLazyExportAction('btn-export-akkord-pdf', 'handleExportAkkordPDF')
    bindLazyExportAction('btn-import-akkord', 'handleImportAkkordAction')
    bindLazyExportAction('btn-print-akkord', 'handlePrintAkkord')
  }

async function ensureExportLibsLazy () {
  if (!exportLibsLoader) {
    exportLibsLoader = import('./src/features/export/lazy-libs.js')
      .then(mod => mod.ensureExportLibs())
  }
  return exportLibsLoader
}

async function ensureZipLibLazy () {
  if (!zipLibLoader) {
    zipLibLoader = import('./src/features/export/lazy-libs.js')
      .then(mod => mod.ensureZipLib())
  }
  return zipLibLoader
}

const IOS_INSTALL_PROMPT_DISMISSED_KEY = 'csmate.iosInstallPromptDismissed'
const TAB_STORAGE_KEY = 'csmate:lastTab'
const LEGACY_TAB_STORAGE_KEYS = ['sscaff:lastTab', 'cssmate:lastActiveTab']
const KNOWN_TAB_ID_ORDER = ['sagsinfo', 'optaelling', 'lon', 'historik', 'delte-sager', 'team', 'hjaelp']
const KNOWN_TAB_IDS = new Set(KNOWN_TAB_ID_ORDER)
const DEFAULT_TAB_ID = KNOWN_TAB_ID_ORDER[0]
const INSTALL_BUTTON_DISABLED_TOOLTIP = 'Tilføj via browsermenu på denne platform'
const PWA_INSTALL_AVAILABLE_EVENT = 'csmate:pwa-install-available'
const PWA_INSTALL_CONSUMED_EVENT = 'csmate:pwa-install-consumed'
let DEFAULT_ADMIN_CODE_HASH = ''
let materialsVirtualListController = null
let currentTabId = null
let exportPanelReady = false
let exportPanelPromise = null
let exportLibsLoader = null
let zipLibLoader = null
let tabButtons = []
let tabPanels = []
let tabsInitialized = false
let sharedCasesModulePromise = null
let teamAdminModulePromise = null
const domCache = new Map()
let deferredInstallPromptEvent = null
let historyPersistencePaused = false
let draftPersistencePaused = false
let materialsDataPromise = null
let materialsUiReadyPromise = null
let materialsWarmupScheduled = false
let tabPanelHeightLocked = false
let a9IntegrationInitialized = false
let tabDiagnosticsPromise = null

function ensureMaterialsDataLoad () {
  if (!materialsDataPromise) {
    materialsDataPromise = ensureMaterialDatasets().catch(error => {
      console.error('Kunne ikke indlæse materialelisterne.', error)
      updateActionHint('Kunne ikke indlæse materialelisterne. Prøv at genindlæse siden.', 'error')
      materialsDataPromise = null
      throw error
    })
  }
  return materialsDataPromise
}

function warmupMaterialsDataLoad () {
  if (materialsWarmupScheduled) return
  materialsWarmupScheduled = true
  runWhenIdle(() => {
    ensureMaterialsDataLoad()?.catch(() => {
      materialsWarmupScheduled = false
    })
  })
}

function ensureMaterialsUiReady () {
  if (!materialsUiReadyPromise) {
    materialsUiReadyPromise = ensureMaterialsDataLoad()
      .then(() => {
        setupListSelectors()
        setupMaterialSearchUi()
        renderOptaelling()
        setupCSVImport()
        populateRecentCases()
        updateTotals(true)
      })
      .catch(error => {
        console.error('Materiale-UI kunne ikke initialiseres', error)
        updateActionHint('Kunne ikke initialisere materialelisterne. Opdater siden for at prøve igen.', 'error')
        materialsUiReadyPromise = null
        throw error
      })
  }
  return materialsUiReadyPromise
}

function setDeferredInstallPromptEvent(event) {
  deferredInstallPromptEvent = event
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  const eventName = event ? PWA_INSTALL_AVAILABLE_EVENT : PWA_INSTALL_CONSUMED_EVENT
  window.dispatchEvent(new Event(eventName))
}

function getDeferredInstallPromptEvent() {
  return deferredInstallPromptEvent
}

function consumeDeferredInstallPromptEvent() {
  const prompt = deferredInstallPromptEvent
  if (prompt) {
    setDeferredInstallPromptEvent(null)
  }
  return prompt
}

function setupInstallPromptListeners () {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault()
    setDeferredInstallPromptEvent(event)
  })

  window.addEventListener('appinstalled', () => {
    setDeferredInstallPromptEvent(null)
  })
}

function pauseHistoryPersistence () {
  historyPersistencePaused = true
}

function resumeHistoryPersistence () {
  historyPersistencePaused = false
}

function pauseDraftPersistence () {
  draftPersistencePaused = true
  if (draftSaveTimer) {
    clearTimeout(draftSaveTimer)
    draftSaveTimer = null
  }
}

function resumeDraftPersistence () {
  draftPersistencePaused = false
}

function isKnownTabId(tabId) {
  return typeof tabId === 'string' && KNOWN_TAB_IDS.has(tabId)
}

function getDomElement (id) {
  if (!id || typeof document === 'undefined' || typeof document.getElementById !== 'function') {
    return null
  }
  const cached = domCache.get(id)
  if (cached && cached.isConnected) {
    return cached
  }
  const element = document.getElementById(id)
  if (element) {
    domCache.set(id, element)
  } else {
    domCache.delete(id)
  }
  return element
}

const KNOWN_ADMIN_CODE_HASHES = new Set([
  'ff0a69fa196820f9529e3c20cfa809545e6697f5796527f7657a83bb7e6acd0d'
])
const KNOWN_ADMIN_CODES = new Set(['StilAce'])

async function loadDefaultAdminCode () {
  try {
    const response = await fetch('./data/tenants/hulmose.json')
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const tenant = await response.json()
    if (tenant && typeof tenant._meta?.admin_code === 'string') {
      DEFAULT_ADMIN_CODE_HASH = tenant._meta.admin_code
      KNOWN_ADMIN_CODE_HASHES.add(DEFAULT_ADMIN_CODE_HASH)
    }
  } catch (error) {
    console.warn('Kunne ikke indlæse standard admin-kode', error)
  }
}

let admin = null

// --- Utility Functions ---
function updateSlaebFormulaInfo(text) {
  const infoEl = document.getElementById('slaebPercentCalcInfo');
  if (!infoEl) return;
  const value = typeof text === 'string' ? text.trim() : '';
  infoEl.textContent = value ? `Formel (A9): ${value}` : '';
}

function setupAdminControls() {
  const hardResetButton = document.getElementById('btnHardResetApp');
  if (!hardResetButton) return;

  const toggleHardResetVisibility = unlocked => {
    if (unlocked) {
      hardResetButton.removeAttribute('hidden');
      hardResetButton.disabled = false;
    } else {
      hardResetButton.setAttribute('hidden', '');
      hardResetButton.disabled = true;
    }
  };

  toggleHardResetVisibility(isAdminUnlocked());

  document.addEventListener('csmate:admin-change', event => {
    toggleHardResetVisibility(Boolean(event?.detail?.unlocked));
  });
}

function getStoredTabId() {
  try {
    const storage = window.localStorage;
    if (!storage) return '';
    const current = storage.getItem(TAB_STORAGE_KEY);
    if (isKnownTabId(current)) return current;
    for (const legacyKey of LEGACY_TAB_STORAGE_KEYS) {
      const legacyValue = storage.getItem(legacyKey);
      if (isKnownTabId(legacyValue)) {
        return legacyValue;
      }
    }
  } catch {}
  return '';
}

function focusTabByIndex(index) {
  if (!ensureTabCollections()) return;
  const normalized = (index + tabButtons.length) % tabButtons.length;
  const button = tabButtons[normalized];
  if (button) {
    setActiveTab(button.dataset.tabId, { focus: true });
  }
}

function handleTabKeydown(event, index) {
  const key = event.key;
  if (key === 'ArrowRight' || key === 'ArrowLeft') {
    event.preventDefault();
    const dir = key === 'ArrowRight' ? 1 : -1;
    focusTabByIndex(index + dir);
    return;
  }
  if (key === 'Home') {
    event.preventDefault();
    focusTabByIndex(0);
    return;
  }
  if (key === 'End') {
    event.preventDefault();
    focusTabByIndex(tabButtons.length - 1);
    return;
  }
  if (key === ' ' || key === 'Enter') {
    event.preventDefault();
    const button = tabButtons[index];
    if (button) {
      setActiveTab(button.dataset.tabId, { focus: true });
    }
  }
}

function logTabDebug (...args) {
  if (!isDevBuild()) return
  if (typeof window === 'undefined' || !window.__TAB_DEBUG__) return
  console.log('[tabs:debug]', ...args)
}

function shouldInitTabDiagnostics () {
  const devFlag = Boolean(typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV)
  if (typeof window === 'undefined') return devFlag
  return devFlag || Boolean(window.__TAB_DEBUG__)
}

function initTabDiagnosticsLazy () {
  if (!shouldInitTabDiagnostics()) return
  if (tabDiagnosticsPromise) return
  tabDiagnosticsPromise = import('./src/dev/tab-diagnostics.js')
    .then(mod => mod?.initTabDiagnostics?.())
    .catch(error => {
      tabDiagnosticsPromise = null
      console.warn('Tab diagnostics init fejlede', error)
    })
}

function refreshTabCollections() {
  if (typeof document === 'undefined') {
    tabButtons = []
    tabPanels = []
    return
  }
  tabButtons = Array.from(document.querySelectorAll('[role="tab"][data-tab-id]'))
    .filter(button => isKnownTabId(button.dataset.tabId) && !button.hasAttribute('data-tab-disabled') && !button.hidden)
  tabPanels = Array.from(document.querySelectorAll('[role="tabpanel"][data-tab-panel]'))
    .filter(panel => isKnownTabId(panel.dataset.tabPanel) && !panel.hasAttribute('data-tab-disabled'))
}

function ensureTabCollections() {
  if (!tabButtons.length || !tabPanels.length) {
    refreshTabCollections()
  }
  return tabButtons.length && tabPanels.length
}

function ensureTabsBound () {
  if (!ensureTabCollections()) return false

  tabButtons.forEach(button => {
    if (button.dataset.tabBound === '1') return
    const tabId = button.dataset.tabId
    const isSelected = button.getAttribute('aria-selected') === 'true'
    button.tabIndex = isSelected ? 0 : -1
    button.addEventListener('click', () => {
      if (typeof window !== 'undefined') {
        window.__tabDebug?.onTabClick?.(tabId)
      }
      setActiveTab(tabId)
    })
    button.addEventListener('keydown', event => {
      const index = tabButtons.indexOf(button)
      handleTabKeydown(event, index >= 0 ? index : 0)
    })
    button.dataset.tabBound = '1'
    logTabDebug('bound tab', tabId)
    if (typeof window !== 'undefined') {
      window.__tabDebug?.registerTabBinding?.(tabId, button)
    }
  })

  const optaellingButton = tabButtons.find(button => button.dataset.tabId === 'optaelling')
  if (optaellingButton && optaellingButton.dataset.tabWarmup !== '1') {
    optaellingButton.dataset.tabWarmup = '1'
    const scheduleWarmup = () => warmupMaterialsDataLoad()
    ;['pointerenter', 'touchstart', 'focusin'].forEach(eventName => {
      optaellingButton.addEventListener(eventName, scheduleWarmup, { once: true, passive: true })
    })
  }

  const sharedCasesButton = tabButtons.find(button => button.dataset.tabId === 'delte-sager')
  if (sharedCasesButton && sharedCasesButton.dataset.tabWarmup !== '1') {
    sharedCasesButton.dataset.tabWarmup = '1'
    const warmupSharedCases = () => ensureSharedCasesPanelLazy().catch(() => {})
    ;['pointerenter', 'touchstart', 'focusin'].forEach(eventName => {
      sharedCasesButton.addEventListener(eventName, warmupSharedCases, { once: true, passive: true })
    })
  }

  const teamButton = tabButtons.find(button => button.dataset.tabId === 'team')
  if (teamButton && teamButton.dataset.tabWarmup !== '1') {
    teamButton.dataset.tabWarmup = '1'
    const warmupTeamAdmin = () => ensureTeamAdminPageLazy().catch(() => {})
    ;['pointerenter', 'touchstart', 'focusin'].forEach(eventName => {
      teamButton.addEventListener(eventName, warmupTeamAdmin, { once: true, passive: true })
    })
  }

  return true
}

function setupTabPanelsStability () {
  if (typeof document === 'undefined') return
  if (tabPanelHeightLocked) return
  const container = document.querySelector('[data-tab-panels]')
  if (!container) return

  const root = document.documentElement
  const parsePxValue = (value) => {
    const num = Number.parseFloat(String(value).replace('px', ''))
    return Number.isFinite(num) ? num : 0
  }
  const applyHeight = (height) => {
    if (!root || !height) return
    const viewport = typeof window !== 'undefined' ? window.innerHeight || height : height
    const clamped = Math.min(Math.max(height, viewport * 0.55), viewport * 1.2)
    const currentMin = parsePxValue(getComputedStyle(root).getPropertyValue('--tab-panels-min-height'))
    const nextValue = Math.round(clamped)
    if (nextValue <= currentMin) return
    root.style.setProperty('--tab-panels-min-height', `${nextValue}px`)
  }

  const measure = () => {
    const active = container.querySelector('.tab-panel.tab-panel--active')
    const height = (active?.offsetHeight || container.offsetHeight || 0)
    applyHeight(height || container.clientHeight || 0)
  }

  measure()

  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(entries => {
      if (tabPanelHeightLocked) return
      const maxHeight = entries.reduce((max, entry) => Math.max(max, entry?.contentRect?.height || 0), 0)
      if (maxHeight > 0) applyHeight(maxHeight)
    })
    observer.observe(container)
    setTimeout(() => {
      tabPanelHeightLocked = true
      observer.disconnect()
    }, 1800)
  } else {
    setTimeout(() => {
      tabPanelHeightLocked = true
    }, 1200)
  }
}

function exposeDebugHooks () {
  if (typeof window === 'undefined') return
  window.__cssmateRefreshTabs = refreshTabsAndValidate
}

function findFirstAvailableTabId() {
  const preferred = KNOWN_TAB_ID_ORDER.find(id => tabButtons.some(button => button.dataset.tabId === id))
  if (preferred) {
    return preferred
  }
  return tabButtons[0]?.dataset.tabId || DEFAULT_TAB_ID
}

function ensureActiveTabAvailable () {
  if (!ensureTabCollections()) return
  const hasActive = tabButtons.some(button => button.dataset.tabId === currentTabId)
  if (!hasActive) {
    setActiveTab(findFirstAvailableTabId(), { focus: false })
  }
}

function refreshTabsAndValidate () {
  refreshTabCollections()
  ensureActiveTabAvailable()
}

function setActiveTab(tabId, { focus = false } = {}) {
  if (!ensureTabCollections()) return;
  const desiredTabId = isKnownTabId(tabId) ? tabId : DEFAULT_TAB_ID
  const nextButton = tabButtons.find(button => button.dataset.tabId === desiredTabId)
    || tabButtons.find(button => button.dataset.tabId === DEFAULT_TAB_ID)
    || tabButtons[0];
  if (!nextButton) {
    console.warn('Faneknap ikke fundet for id', tabId);
    return;
  }
  const nextTabId = nextButton.dataset.tabId;
  if (!nextTabId) {
    console.warn('Faneknap mangler data-tab-id', nextButton);
    return;
  }
  const nextPanel = tabPanels.find(panel => panel.dataset.tabPanel === nextTabId);
  if (!nextPanel) {
    console.warn('Tab-panel ikke fundet for id', nextTabId);
    return;
  }

  if (currentTabId === nextTabId) {
    if (focus && typeof nextButton.focus === 'function') {
      nextButton.focus();
    }
    return;
  }

  tabButtons.forEach(button => {
    const isActive = button === nextButton;
    button.classList.toggle('tab--active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    button.tabIndex = isActive ? 0 : -1;
  });

  tabPanels.forEach(panel => {
    const matches = panel === nextPanel;
    panel.classList.toggle('tab-panel--active', matches);
    if (matches) {
      panel.removeAttribute('hidden');
      panel.setAttribute('aria-hidden', 'false');
    } else {
      panel.setAttribute('hidden', '');
      panel.setAttribute('aria-hidden', 'true');
    }
  });

  currentTabId = nextTabId;
  updateCurrentView(nextTabId)
  if (typeof window !== 'undefined') {
    window.__tabDebug?.setActiveTab?.(nextTabId)
  }
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('cssmate:tab-change', { detail: { tabId: nextTabId } }))
  }
  try {
    const storage = window.localStorage;
    if (storage) {
      if (isKnownTabId(nextTabId)) {
        storage.setItem(TAB_STORAGE_KEY, nextTabId);
        LEGACY_TAB_STORAGE_KEYS.forEach(key => {
          try {
            storage.setItem(key, nextTabId);
          } catch {}
        });
      }
    }
  } catch {}

  if (nextTabId === 'optaelling') {
    ensureMaterialsUiReady().catch(() => {});
  }

  if (nextTabId === 'lon') {
    ensureWorkersInitialized();
    if (!a9IntegrationInitialized) {
      a9IntegrationInitialized = true;
      setupA9Integration();
    }
  }

  if (nextTabId === 'delte-sager') {
    runWhenIdle(() => ensureSharedCasesPanelLazy().catch(() => {}))
  }

  if (nextTabId === 'team') {
    runWhenIdle(() => ensureTeamAdminPageLazy().catch(() => {}))
  }

  if (nextTabId === 'historik') {
    runWhenIdle(() => populateRecentCases())
  }

  if (focus && typeof nextButton.focus === 'function') {
    nextButton.focus();
  }
}

// Initier faner og tastaturnavigation
function initTabs() {
  if (tabsInitialized) {
    ensureTabsBound()
    return
  }

  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initTabs(), { once: true })
    return
  }

  refreshTabCollections()

  const bindTabs = () => {
    if (tabsInitialized) return
    if (!ensureTabsBound()) return
    const storedTabId = getStoredTabId();
    const initialTabId = tabButtons.some(button => button.dataset.tabId === storedTabId)
      ? storedTabId
      : (tabButtons.find(button => button.getAttribute('aria-selected') === 'true')?.dataset.tabId || findFirstAvailableTabId());

    tabsInitialized = true
    setActiveTab(initialTabId, { focus: false })

    if (typeof window !== 'undefined') {
      window.__cssmateSetActiveTab = (tabId, options) => setActiveTab(tabId, options)
    }
  }

  if (!tabButtons.length || !tabPanels.length) {
    if (typeof document === 'undefined') {
      return
    }
    const hasTabMarkup = document.querySelector('[role="tab"][data-tab-id]') || document.querySelector('[role="tabpanel"][data-tab-panel]')
    if (!hasTabMarkup) {
      return
    }
    const retryInitTabs = () => {
      if (tabsInitialized) return
      refreshTabCollections()
      if (!tabButtons.length || !tabPanels.length) {
        console.warn('Faner kunne ikke initialiseres – mangler markup')
        return
      }
      bindTabs()
    }

    if (typeof document !== 'undefined' && document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', retryInitTabs, { once: true })
    } else {
      runWhenIdle(retryInitTabs)
    }
    return
  }

  bindTabs()
}

function setupA9Integration() {
  const slaebInput = document.querySelector('input[data-a9-slaeb="true"]');
  const openBtn = document.querySelector('.js-slaeb-calc-link');

  if (openBtn) {
    const calcUrl = openBtn.dataset.calcUrl || 'https://cala9.netlify.app/';
    openBtn.addEventListener('click', event => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      window.open(calcUrl, '_blank', 'noopener,noreferrer');
    });
  }

  if (!slaebInput) {
    return;
  }

  slaebInput.addEventListener('a9-commit', event => {
    const formulaText = typeof event?.detail?.formulaText === 'string'
      ? event.detail.formulaText
      : '';
    setSlaebFormulaText(formulaText);
    updateSlaebFormulaInfo(formulaText);
  });

  const handleManualUpdate = () => {
    if (slaebInput.dataset.a9Commit === '1') {
      return;
    }
    setSlaebFormulaText('');
    const manualValue = slaebInput.value?.trim();
    if (manualValue) {
      updateSlaebFormulaInfo(`Manuel værdi: ${manualValue}`);
    } else {
      updateSlaebFormulaInfo('');
    }
  };

  slaebInput.addEventListener('input', handleManualUpdate);
  slaebInput.addEventListener('change', handleManualUpdate);

  updateSlaebFormulaInfo(exportMeta.slaebFormulaText);
}

function formatCurrency(value) {
  return new Intl.NumberFormat('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);
}

function toNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (value == null) {
    return 0;
  }

  const stringValue = String(value).trim();
  if (!stringValue) {
    return 0;
  }

  const compactValue = stringValue.replace(/\s+/g, '').replace(/'/g, '');
  const separators = compactValue.match(/[.,]/g) || [];
  let normalized = compactValue.replace(/[^0-9.,-]/g, '');

  if (separators.length > 1) {
    const lastSeparator = separators[separators.length - 1];
    const decimalIndex = normalized.lastIndexOf(lastSeparator);
    const integerPart = normalized.slice(0, decimalIndex).replace(/[.,]/g, '').replace(/(?!^)-/g, '');
    const fractionalPart = normalized.slice(decimalIndex + 1).replace(/[^0-9]/g, '');
    normalized = `${integerPart || '0'}.${fractionalPart}`;
  } else if (separators.length === 1) {
    if (/^-?\d{1,3}(?:[.,]\d{3})+$/.test(normalized)) {
      normalized = normalized.replace(/[.,]/g, '').replace(/(?!^)-/g, '');
    } else {
      const separator = separators[0];
      const decimalIndex = normalized.lastIndexOf(separator);
      const integerPart = normalized.slice(0, decimalIndex).replace(/[.,]/g, '').replace(/(?!^)-/g, '');
      const fractionalPart = normalized.slice(decimalIndex + 1).replace(/[^0-9]/g, '');
      normalized = `${integerPart || '0'}.${fractionalPart}`;
    }
  } else {
    normalized = normalized.replace(/(?!^)-/g, '');
  }

  const num = Number.parseFloat(normalized);
  return Number.isFinite(num) ? num : 0;
}

function formatNumber(value) {
  const num = Number.isFinite(value) ? value : (parseFloat(value) || 0);
  return new Intl.NumberFormat('da-DK', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(num);
}

// --- Global Variables ---
let workerCount = 0;
let laborEntries = [];
let lastLoensum = 0;
let lastMaterialSum = 0;
let lastExportModel = null;
let lastEkompletData = null;
let lastJobSummary = null;
let recentCasesCache = [];

function deriveSagsinfoFromEntry(entry = {}) {
  const meta = entry.meta || {};
  const info = entry.data?.sagsinfo || {};
  const payloadInfo = entry.payload?.job?.info || entry.payload?.info || {};
  return {
    sagsnummer: meta.sagsnummer || info.sagsnummer || payloadInfo.sagsnummer || payloadInfo.caseNumber || '',
    navn: meta.navn || info.navn || payloadInfo.navn || payloadInfo.opgave || payloadInfo.title || '',
    adresse: meta.adresse || info.adresse || payloadInfo.adresse || payloadInfo.address || payloadInfo.site || '',
    kunde: meta.kunde || info.kunde || payloadInfo.kunde || payloadInfo.customer || '',
    dato: meta.dato || info.dato || payloadInfo.dato || payloadInfo.date || '',
    montoer: meta.montoer || info.montoer || payloadInfo.montoer || payloadInfo.worker || payloadInfo.montor || '',
  };
}

function syncRecentProjectsGlobal(entries = recentCasesCache) {
  if (typeof window === 'undefined') return;
  const payload = Array.isArray(entries) ? entries.slice() : [];
  window.__cssmateRecentProjects = payload;
}

syncRecentProjectsGlobal([]);
let cachedDBPromise = null;
const DEFAULT_ACTION_HINT = 'Udfyld Sagsinfo for at fortsætte.';
const DB_NAME = 'csmate_projects';
const DB_STORE = 'projects';
const TRAELLE_RATE35 = 10.44;
const TRAELLE_RATE50 = 14.62;
const BORING_HULLER_RATE = 4.70;
const LUK_HULLER_RATE = 3.45;
const BORING_BETON_RATE = 11.49;
const OPSKYDELIGT_RATE = 9.67;
const KM_RATE = 2.12;
const TILLAEG_UDD1 = 42.98;
const TILLAEG_UDD2 = 49.38;
const DEFAULT_MENTOR_RATE = 22.26;

const historyNormalizeOptions = {
  tillaegUdd1: TILLAEG_UDD1,
  tillaegUdd2: TILLAEG_UDD2,
  mentorRate: DEFAULT_MENTOR_RATE,
};

const normalizeHistoryEntry = entry => {
  if (!entry) return null;
  let data = entry.data;
  if (!data && entry.payload) {
    try {
      data = normalizeImportedJsonSnapshot(entry.payload);
    } catch (error) {
      console.warn('Kunne ikke normalisere historik-post', error);
    }
  }
  const normalized = baseNormalizeHistoryEntry({ ...entry, data }, historyNormalizeOptions);
  if (normalized && !normalized.caseKey) {
    normalized.caseKey = entry?.caseKey || computeHistoryKey(normalized) || normalized.id;
  }
  return normalized;
};
const MATERIAL_SEARCH_DEBOUNCE_MS = 130;
const MATERIAL_SEARCH_SUGGESTION_LIMIT = 6;
const UI_SCALE_STORAGE_KEY = 'sscaff.uiScale';
const UI_SCALE_DEFAULT = 1;
const UI_SCALE_MIN = 0.75;
const UI_SCALE_MAX = 1.1;
const UI_SCALE_STEP = 0.05;
let systemDatasets = {};
let dataBosta = [];
let dataHaki = [];
let dataModex = [];
let dataAlfix = [];
let systemOptions = [];
const SYSTEM_ACCESSIBLE_LABELS = {
  bosta: 'BOSTA 2025',
  haki: 'HAKI 2025',
  modex: 'MODEX 2025',
  alfix: 'ALFIX 2025',
};
let systemLabelMap = new Map();
const selectedSystemKeys = new Set();
let datasetModulePromise = null;
let materialsReady = false;
let showOnlySelectedMaterials = false;
let lastRenderShowSelected = null;
let materialsSearchQuery = '';
let materialsSearchQueryNormalized = '';
let materialsSearchInput = null;
let materialsSearchClearBtn = null;
let materialsSearchStats = null;
let materialsSearchSuggestions = null;
let materialsSearchDebounce = null;
let lastMaterialBaseList = [];
let lastRenderedMaterials = [];
let detachMaterialScrollHandler = null;
let uiScale = UI_SCALE_DEFAULT;
let uiScalePopover = null;
let uiScaleToggle = null;
let lonOutputsRevealed = false;
let historySearchTerm = '';
const HISTORY_PAGE_SIZE = 50;
let historyVisibleCount = HISTORY_PAGE_SIZE;
let historyFilters = { recentDays: 0, requireCaseNumber: false, requireWorkerRates: false };
let openHistoryId = null;
let normalizedHistoryCache = [];
let filteredHistoryCache = [];
let draftSaveTimer = null;
let lastDraftSerialized = '';
const DRAFT_SAVE_DEBOUNCE = 350;

function clampUiScale(value) {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) return UI_SCALE_DEFAULT;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, numeric));
}

function applyUiScale(value) {
  uiScale = clampUiScale(value);
  if (typeof document !== 'undefined' && document.documentElement?.style) {
    document.documentElement.style.setProperty('--uiScale', uiScale);
    const label = document.getElementById('uiScaleValue');
    if (label) {
      label.textContent = `${Math.round(uiScale * 100)}%`;
    }
  }
  try {
    window.localStorage?.setItem(UI_SCALE_STORAGE_KEY, String(uiScale));
  } catch {}
}

function bootstrapUiScale() {
  if (typeof window === 'undefined') {
    applyUiScale(UI_SCALE_DEFAULT);
    return;
  }
  let next = UI_SCALE_DEFAULT;
  try {
    const stored = window.localStorage?.getItem(UI_SCALE_STORAGE_KEY);
    const parsed = Number.parseFloat(stored);
    if (Number.isFinite(parsed)) {
      next = parsed;
    }
  } catch {}
  applyUiScale(next);
}

function changeUiScale(delta) {
  const step = Number.isFinite(delta) ? delta : UI_SCALE_STEP;
  const next = uiScale + step;
  applyUiScale(next);
}

function setupUiScaleControls() {
  uiScaleToggle = document.getElementById('uiScaleToggle');
  uiScalePopover = document.getElementById('uiScalePopover');
  const valueLabel = document.getElementById('uiScaleValue');
  if (valueLabel) {
    valueLabel.textContent = `${Math.round(uiScale * 100)}%`;
  }
  if (!uiScaleToggle || !uiScalePopover) return;

  const togglePopover = open => {
    if (!uiScalePopover) return;
    if (open) {
      uiScalePopover.removeAttribute('hidden');
      uiScaleToggle?.setAttribute('aria-expanded', 'true');
    } else {
      uiScalePopover.setAttribute('hidden', '');
      uiScaleToggle?.setAttribute('aria-expanded', 'false');
    }
  };

  uiScaleToggle.addEventListener('click', event => {
    event.stopPropagation();
    const shouldOpen = uiScalePopover?.hasAttribute('hidden');
    togglePopover(shouldOpen);
  });

  uiScalePopover.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.scale) {
      applyUiScale(Number.parseFloat(target.dataset.scale));
      togglePopover(false);
    } else if (target.dataset.scaleStep) {
      changeUiScale(Number.parseFloat(target.dataset.scaleStep));
    } else if (target.dataset.scaleReset) {
      applyUiScale(UI_SCALE_DEFAULT);
      togglePopover(false);
    }
  });

  document.addEventListener('click', event => {
    if (!uiScalePopover || uiScalePopover.hasAttribute('hidden')) return;
    if (uiScalePopover.contains(event.target) || uiScaleToggle?.contains(event.target)) return;
    togglePopover(false);
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && uiScalePopover && !uiScalePopover.hasAttribute('hidden')) {
      togglePopover(false);
    }
  });
}

bootstrapUiScale();

function loadMaterialDatasetModule () {
  if (!datasetModulePromise) {
    datasetModulePromise = import('./dataset.js');
  }
  return datasetModulePromise;
}

function normalizeQuery(value) {
  if (value == null) return '';
  return String(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSearchKey(item) {
  if (!item) return '';
  const parts = [];
  const name = item.name || item.label || '';
  const systemKey = item.systemKey || item.system || '';
  const systemLabel = item.systemLabel || SYSTEM_ACCESSIBLE_LABELS[systemKey];
  if (name) parts.push(name);
  if (systemKey) parts.push(systemKey);
  if (systemLabel) parts.push(systemLabel);
  if (item.id) parts.push(item.id);
  return normalizeQuery(parts.join(' '));
}

function getMaterialSearchKey(item) {
  if (!item) return '';
  if (item.searchKey) return item.searchKey;
  const key = buildSearchKey(item);
  item.searchKey = key;
  return key;
}

function updateMaterialSearchKey(item) {
  if (!item) return '';
  const key = buildSearchKey(item);
  item.searchKey = key;
  return key;
}

// --- Scaffold Part Lists ---
function createSystemMaterialState(system) {
  if (!system || !Array.isArray(system.items)) return [];
  return system.items
    .filter(item => {
      const category = typeof item?.category === 'string'
        ? item.category.toLowerCase()
        : 'material';
      if (category && category !== 'material' && category !== 'materiale') {
        return false;
      }
      const rawName = item?.name || item?.navn || item?.beskrivelse || '';
      const key = normalizeKey(String(rawName).trim());
      return key && !EXCLUDED_MATERIAL_KEYS.includes(key);
    })
    .map((item, index) => {
      const baseName = item?.name || item?.navn || item?.beskrivelse || '';
      const name = baseName?.trim() || `${system.id} materiale ${index + 1}`;
      const idValue = item?.id || item?.varenr || `${system.id}-${index + 1}`;
      return {
        id: idValue,
        name,
        price: toNumber(item?.price ?? item?.pris ?? 0),
        unit: item?.unit || item?.enhed || '',
        quantity: 0,
        systemKey: system.id,
        systemLabel: system.label,
        searchKey: buildSearchKey({ name, id: idValue, systemKey: system.id, systemLabel: system.label }),
        category: typeof item?.category === 'string'
          ? item.category.toLowerCase()
          : 'material',
      };
    });
}

async function ensureMaterialDatasets () {
  if (systemOptions.length) {
    return systemOptions;
  }

  const mod = await loadMaterialDatasetModule();
  const allSystems = typeof mod.getAllSystems === 'function' ? mod.getAllSystems() : [];
  systemDatasets = {};
  allSystems.forEach(system => {
    systemDatasets[system.id] = createSystemMaterialState(system);
  });

  dataBosta = systemDatasets.bosta ?? [];
  dataHaki = systemDatasets.haki ?? [];
  dataModex = systemDatasets.modex ?? [];
  dataAlfix = systemDatasets.alfix ?? [];

  systemOptions = allSystems.map(system => ({
    key: system.id,
    label: system.label,
    dataset: systemDatasets[system.id] ?? [],
  }));

  const labelEntries = Object.keys(mod.MATERIAL_SYSTEMS || {}).map(key => {
    const system = typeof mod.getSystemList === 'function' ? mod.getSystemList(key) : null;
    return [key, system?.label ?? key];
  });
  systemLabelMap = new Map(labelEntries);

  materialsReady = true;
  ensureSystemSelection();
  return systemOptions;
}

function ensureSystemSelection() {
  if (selectedSystemKeys.size === 0 && systemOptions.length) {
    selectedSystemKeys.add(systemOptions[0].key);
  }
}

function getSelectedSystemKeys() {
  ensureSystemSelection();
  return Array.from(selectedSystemKeys);
}

function getDatasetForSelectedSystems(selected) {
  const lists = [];
  const rawSelection = Array.isArray(selected)
    ? selected
    : (selected && typeof selected[Symbol.iterator] === 'function'
      ? Array.from(selected)
      : []);
  const normalizedSelection = rawSelection.map(value => normalizeKey(value));
  const selectionSet = new Set(normalizedSelection);

  const addIfSelected = (synonyms, dataset) => {
    if (!Array.isArray(dataset)) return;
    const match = synonyms.some(key => selectionSet.has(normalizeKey(key)));
    if (match) {
      lists.push(dataset);
    }
  };

  addIfSelected(['bosta', 'bostadata'], dataBosta);
  addIfSelected(['haki', 'hakidata'], dataHaki);
  addIfSelected(['modex', 'modexdata'], dataModex);
  addIfSelected(['alfix', 'alfixdata'], dataAlfix);

  return lists.flat();
}

function toggleDuplicateWarning(duplicates = [], conflicts = []) {
  const warning = document.getElementById('systemDuplicateWarning');
  if (!warning) return;
  const duplicateNames = Array.from(new Set(duplicates.filter(Boolean))).slice(0, 6);
  const conflictNames = Array.from(new Set(conflicts.filter(Boolean))).slice(0, 6);
  if (duplicateNames.length === 0 && conflictNames.length === 0) {
    warning.textContent = '';
    warning.setAttribute('hidden', '');
    return;
  }

  const parts = [];
  if (duplicateNames.length) {
    parts.push(`Materialer slået sammen: ${duplicateNames.join(', ')}`);
  }
  if (conflictNames.length) {
    parts.push(`Kontroller varenr.: ${conflictNames.join(', ')}`);
  }
  warning.textContent = parts.join('. ');
  warning.removeAttribute('hidden');
}

function aggregateSelectedSystemData() {
  const datasets = getDatasetForSelectedSystems(getSelectedSystemKeys());
  const aggregated = [];
  const seenIds = new Map();
  const seenNames = new Map();
  const duplicateNames = new Set();
  const conflictingIds = new Set();

  datasets.forEach(item => {
    if (!item) return;
    const idKey = item.id != null ? String(item.id) : null;
    const baseNameKey = item.name ? normalizeKey(item.name) : null;
    const scopedNameKey = baseNameKey
      ? `${item.systemKey || 'global'}::${baseNameKey}`
      : null;
    const existingByName = scopedNameKey ? seenNames.get(scopedNameKey) : null;
    if (existingByName && existingByName !== item) {
      duplicateNames.add(existingByName.name);
      duplicateNames.add(item.name);
      return;
    }

      const existingById = idKey ? seenIds.get(idKey) : null;
      if (existingById && existingById !== item) {
        const existingNameKey = existingById.name ? normalizeKey(existingById.name) : null;
        if (existingNameKey && baseNameKey && existingNameKey === baseNameKey) {
          duplicateNames.add(existingById.name);
          duplicateNames.add(item.name);
          return;
        }
        conflictingIds.add(existingById.name);
      conflictingIds.add(item.name);
    }

    aggregated.push(item);
    if (idKey) {
      seenIds.set(idKey, item);
    }
    if (scopedNameKey) {
      seenNames.set(scopedNameKey, item);
    }
  });

  toggleDuplicateWarning(Array.from(duplicateNames), Array.from(conflictingIds));
  return aggregated;
}

const manualMaterials = Array.from({ length: 3 }, (_, index) => ({
  id: `manual-${index + 1}`,
  name: '',
  price: 0,
  quantity: 0,
  manual: true,
  searchKey: '',
}));

function getAllData(includeManual = true) {
  const combined = aggregateSelectedSystemData();
  if (!includeManual) return combined;
  return combined.concat(manualMaterials);
}

function getActiveMaterialList() {
  return aggregateSelectedSystemData();
}

function getRenderMaterials() {
  const activeItems = getActiveMaterialList();
  const combined = Array.isArray(activeItems)
    ? activeItems.concat(manualMaterials)
    : manualMaterials.slice();

  const baseList = showOnlySelectedMaterials
    ? combined.filter(item => toNumber(item?.quantity) > 0)
    : combined;
  lastMaterialBaseList = baseList;

  if (!materialsSearchQueryNormalized) {
    updateMaterialSearchStats(baseList.length, baseList.length);
    updateMaterialSuggestions();
    return baseList;
  }

  const filtered = baseList.filter(item => {
    const key = getMaterialSearchKey(item);
    return key ? key.includes(materialsSearchQueryNormalized) : false;
  });
  updateMaterialSearchStats(filtered.length, baseList.length);
  updateMaterialSuggestions();
  return filtered;
}

function updateMaterialSearchStats(visible = 0, total = 0) {
  if (!materialsSearchStats) return;
  if (!total) {
    materialsSearchStats.textContent = '';
    return;
  }
  materialsSearchStats.textContent = `Viser ${visible} / ${total}`;
}

function clearMaterialSuggestions() {
  if (!materialsSearchSuggestions) return;
  materialsSearchSuggestions.innerHTML = '';
  materialsSearchSuggestions.setAttribute('hidden', '');
}

function scrollFirstMaterialMatch(normalizedQuery) {
  if (!normalizedQuery) return;
  const index = lastRenderedMaterials.findIndex(item => {
    const key = getMaterialSearchKey(item);
    return key && key.includes(normalizedQuery);
  });
  if (index < 0) return;

  if (materialsVirtualListController?.container) {
    const rowHeight = materialsVirtualListController.rowHeight || 64;
    const targetScroll = Math.max(index - 1, 0) * rowHeight;
    try {
      materialsVirtualListController.container.scrollTo({ top: targetScroll, behavior: 'smooth' });
    } catch {
      materialsVirtualListController.container.scrollTop = targetScroll;
    }
    return;
  }

  const list = document.querySelector('.materials-list');
  if (!list) return;
  const rowElement = list.querySelector(`[data-index="${index}"]`) || list.querySelectorAll('.material-row')[index];
  if (!rowElement) return;
  rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function updateMaterialSuggestions() {
  if (!materialsSearchSuggestions) return;
  if (!materialsSearchQueryNormalized || materialsSearchQueryNormalized.length < 2 || lastMaterialBaseList.length === 0) {
    clearMaterialSuggestions();
    return;
  }

  const suggestions = [];
  const seen = new Set();
  for (const item of lastMaterialBaseList) {
    const key = getMaterialSearchKey(item);
    if (!key || !key.includes(materialsSearchQueryNormalized)) continue;
    const label = item.name || item.id || 'Materiale';
    const normalizedLabel = normalizeQuery(label);
    if (seen.has(normalizedLabel)) continue;
    suggestions.push(label);
    seen.add(normalizedLabel);
    if (suggestions.length >= MATERIAL_SEARCH_SUGGESTION_LIMIT) break;
  }

  if (!suggestions.length) {
    clearMaterialSuggestions();
    return;
  }

  materialsSearchSuggestions.innerHTML = '';
  const fragment = document.createDocumentFragment();
  suggestions.forEach(text => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'material-search__suggestion';
    btn.textContent = text;
    btn.addEventListener('click', () => {
      setMaterialSearchQuery(text, { immediate: true });
      scrollFirstMaterialMatch(materialsSearchQueryNormalized);
      clearMaterialSuggestions();
      materialsSearchInput?.blur();
    });
    fragment.appendChild(btn);
  });
  materialsSearchSuggestions.appendChild(fragment);
  materialsSearchSuggestions.removeAttribute('hidden');
}

function toggleMaterialSearchClear() {
  if (!materialsSearchClearBtn) return;
  const hasValue = Boolean(materialsSearchQuery);
  materialsSearchClearBtn.hidden = !hasValue;
}

function setMaterialSearchQuery(value, { immediate = true, syncInput = true } = {}) {
  materialsSearchQuery = value || '';
  materialsSearchQueryNormalized = normalizeQuery(materialsSearchQuery);
  if (syncInput && materialsSearchInput && materialsSearchInput.value !== materialsSearchQuery) {
    materialsSearchInput.value = materialsSearchQuery;
  }
  toggleMaterialSearchClear();
  if (immediate) {
    renderOptaelling();
  }
}

function scheduleMaterialSearchUpdate(value) {
  if (materialsSearchDebounce) {
    clearTimeout(materialsSearchDebounce);
  }
  materialsSearchDebounce = setTimeout(() => {
    setMaterialSearchQuery(value);
  }, MATERIAL_SEARCH_DEBOUNCE_MS);
}

function resetMaterialSearch(shouldRender = true) {
  if (materialsSearchDebounce) {
    clearTimeout(materialsSearchDebounce);
    materialsSearchDebounce = null;
  }
  materialsSearchQuery = '';
  materialsSearchQueryNormalized = '';
  if (materialsSearchInput) {
    materialsSearchInput.value = '';
  }
  toggleMaterialSearchClear();
  clearMaterialSuggestions();
  updateMaterialSearchStats(0, 0);
  if (shouldRender) {
    renderOptaelling();
  }
}

function attachMaterialSearchScrollHandler(scrollElement) {
  if (detachMaterialScrollHandler) {
    detachMaterialScrollHandler();
  }
  if (!scrollElement) return;
  let lastScrollTop = scrollElement.scrollTop;
  let rafId = null;
  const onScroll = () => {
    const current = scrollElement.scrollTop;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      if (Math.abs(current - lastScrollTop) > 10 && document.activeElement === materialsSearchInput) {
        materialsSearchInput.blur();
      }
      lastScrollTop = current;
    });
  };
  scrollElement.addEventListener('scroll', onScroll, { passive: true });
  detachMaterialScrollHandler = () => {
    scrollElement.removeEventListener('scroll', onScroll);
    if (rafId) cancelAnimationFrame(rafId);
    detachMaterialScrollHandler = null;
  };
}

function findMaterialById(id) {
  const allSets = [dataBosta, dataHaki, dataModex, dataAlfix, manualMaterials];
  for (const list of allSets) {
    const match = list.find(item => String(item.id) === String(id));
    if (match) return match;
  }
  return null;
}

// --- UI for List Selection ---
function setupListSelectors() {
  const container = getDomElement('listSelectors');
  if (!container) return;
  const warningId = 'systemSelectionWarning';
  const duplicateWarningId = 'systemDuplicateWarning';
  const optionsHtml = systemOptions
    .map(option => {
      const checked = selectedSystemKeys.has(option.key) ? 'checked' : '';
      const accessibleLabel = SYSTEM_ACCESSIBLE_LABELS[option.key] || option.label;
      return `
        <label class="system-option">
          <input type="checkbox" value="${option.key}" ${checked} aria-label="${accessibleLabel}">
          <span aria-hidden="true">${option.label}</span>
        </label>
      `;
    })
    .join('');

  container.innerHTML = `
    <div class="system-selector" role="group" aria-labelledby="systemSelectorLabel">
      <span id="systemSelectorLabel" class="cell-label">Systemer</span>
      <div class="system-selector-options">${optionsHtml}</div>
    </div>
    <p id="${warningId}" class="hint system-warning" hidden>Vælg mindst ét system.</p>
    <p id="${duplicateWarningId}" class="hint system-warning" hidden></p>
  `;

  syncSystemSelectorState();
  const warning = document.getElementById(warningId);

  container.addEventListener('change', event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return;

    const { value } = target;
    if (target.checked) {
      selectedSystemKeys.add(value);
    } else {
      selectedSystemKeys.delete(value);
      if (selectedSystemKeys.size === 0) {
        warning?.removeAttribute('hidden');
        selectedSystemKeys.add(value);
        target.checked = true;
        updateActionHint('Vælg mindst ét system for at fortsætte optællingen.', 'error');
        return;
      }
    }

    warning?.setAttribute('hidden', '');
    const hint = getDomElement('actionHint');
    if (hint && hint.textContent === 'Vælg mindst ét system for at fortsætte optællingen.') {
      updateActionHint('');
    }
    renderOptaelling();
    updateTotals(true);
  });
}

function setupMaterialSearchUi() {
  const container = getDomElement('materialSearchBar');
  if (!container || container.dataset.ready === 'true') return;
  container.dataset.ready = 'true';
  container.classList.add('material-search');

  const row = document.createElement('div');
  row.className = 'material-search__row';

  const icon = document.createElement('span');
  icon.className = 'material-search__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '🔍';

  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Søg materiale…';
  input.autocomplete = 'off';
  input.enterKeyHint = 'search';
  input.inputMode = 'search';
  input.setAttribute('aria-label', 'Søg efter materiale');

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'material-search__clear';
  clearBtn.textContent = '×';
  clearBtn.hidden = true;

  row.append(icon, input, clearBtn);

  const meta = document.createElement('div');
  meta.className = 'material-search__meta';
  meta.setAttribute('aria-live', 'polite');

  const suggestions = document.createElement('div');
  suggestions.className = 'material-search__suggestions';
  suggestions.setAttribute('hidden', '');

  container.append(row, meta, suggestions);

  materialsSearchInput = input;
  materialsSearchClearBtn = clearBtn;
  materialsSearchStats = meta;
  materialsSearchSuggestions = suggestions;

  input.addEventListener('input', event => {
    const value = event?.target?.value ?? '';
    scheduleMaterialSearchUpdate(value);
    clearMaterialSuggestions();
  });
  input.addEventListener('focus', () => updateMaterialSuggestions());
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      resetMaterialSearch();
    }
  });

  clearBtn.addEventListener('click', () => {
    resetMaterialSearch();
    materialsSearchInput?.focus();
  });

  toggleMaterialSearchClear();
}

function syncSystemSelectorState() {
  const container = getDomElement('listSelectors');
  if (!container) return;
  container.querySelectorAll('input[type="checkbox"]').forEach(input => {
    input.checked = selectedSystemKeys.has(input.value);
  });
}

// --- Rendering Functions ---
function renderOptaelling() {
  const container = getDomElement('optaellingContainer');
  if (!container) return;

  const selectedToggle = document.getElementById('showSelectedOnly');
  if (selectedToggle) {
    selectedToggle.checked = showOnlySelectedMaterials;
    selectedToggle.onchange = () => {
      showOnlySelectedMaterials = selectedToggle.checked;
      lastRenderShowSelected = null;
      renderOptaelling();
    };
  }

  const showEmptyState = message => {
    container.textContent = '';
    const paragraph = document.createElement('p');
    paragraph.className = 'empty-state';
    paragraph.textContent = message;
    container.appendChild(paragraph);
    if (materialsVirtualListController) {
      materialsVirtualListController.controller.destroy?.();
      materialsVirtualListController = null;
    }
    if (detachMaterialScrollHandler) {
      detachMaterialScrollHandler();
    }
    lastMaterialBaseList = [];
    lastRenderedMaterials = [];
    updateMaterialSearchStats(0, 0);
    clearMaterialSuggestions();
  };

  if (!materialsReady) {
    showEmptyState('Indlæser materialelister...');
    return;
  }
  syncSystemSelectorState();

  const activeItems = getActiveMaterialList();
  const combinedItems = Array.isArray(activeItems)
    ? activeItems.concat(manualMaterials)
    : manualMaterials.slice();
  const items = getRenderMaterials();
  lastRenderedMaterials = items;

  if (!combinedItems.length) {
    showEmptyState('Ingen systemer valgt. Vælg et eller flere systemer for at starte optællingen.');
    return;
  }

  if (!items.length) {
    showEmptyState('Ingen materialer med antal.');
    return;
  }

  container.querySelectorAll('.empty-state').forEach(node => node.remove());

  let list = container.querySelector('.materials-list');
  if (!list) {
    container.textContent = '';
    list = document.createElement('div');
    list.className = 'materials-list csm-materials-list';
    container.appendChild(list);
  }
  list.classList.add('csm-materials-list');

  const renderRow = (item, index) => {
    const result = createMaterialRow(item, {
      admin,
      toNumber,
      formatCurrency,
      systemLabelMap
    })
    const row = result?.row || result
    if (row) {
      row.dataset.index = String(index)
    }
    return result
  }

  if (materialsVirtualListController) {
    materialsVirtualListController.controller.destroy?.();
    materialsVirtualListController = null;
  }
  lastRenderShowSelected = showOnlySelectedMaterials;

  // Force non-virtual list (variable row height safe)
  list.classList.remove('materials-virtual-list');
  list.style.position = '';
  list.style.overflowY = '';
  list.style.willChange = '';
  list.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const result = renderRow(item, index);
    const rowEl = result?.row || result;
    if (rowEl) frag.appendChild(rowEl);
  }
  list.appendChild(frag);

  attachMaterialSearchScrollHandler(list)

  initMaterialsScrollLock(container)
  updateTotals(true)
}

// --- Update Functions ---
function handleOptaellingInput(event) {
  const target = event.target;
  if (!target || !target.classList) return;
  if (target.classList.contains('qty')) {
    handleQuantityChange(event);
  } else if (target.classList.contains('price')) {
    handlePriceChange(event);
  } else if (target.classList.contains('manual-name')) {
    handleManualNameChange(event);
  }
}

function handleQuantityChange(event) {
  const { id } = event.target.dataset;
  updateQty(id, event.target.value);
}

function handlePriceChange(event) {
  const { id } = event.target.dataset;
  updatePrice(id, event.target.value);
}

function handleManualNameChange(event) {
  const { id } = event.target.dataset;
  const item = findMaterialById(id);
  if (item && item.manual) {
    item.name = event.target.value;
    updateMaterialSearchKey(item);
    if (materialsSearchQueryNormalized) {
      renderOptaelling();
    }
  }
}

function findMaterialRowElement(id) {
  const rows = document.querySelectorAll('.material-row');
  return Array.from(rows).find(row =>
    Array.from(row.querySelectorAll('input[data-id]')).some(input => input.dataset.id === String(id))
  ) || null;
}

function updateQty(id, val) {
  const item = findMaterialById(id);
  if (!item) return;
  const previousQuantity = toNumber(item.quantity);
  const newQuantity = toNumber(val);
  item.quantity = newQuantity;
  refreshMaterialRowDisplay(id);
  updateTotals();
  if (showOnlySelectedMaterials) {
    const wasSelected = previousQuantity > 0;
    const isSelected = newQuantity > 0;
    if (wasSelected !== isSelected) {
      renderOptaelling();
    }
  }
}

function updatePrice(id, val) {
  const item = findMaterialById(id);
  if (!item) return;
  if (!item.manual && !admin) return;
  item.price = toNumber(val);
  refreshMaterialRowDisplay(id);
  updateTotals();
}

function refreshMaterialRowDisplay(id) {
  const item = findMaterialById(id);
  if (!item) return;
  const row = findMaterialRowElement(id);
  if (!row) return;

  const qtyInput = row.querySelector('input.qty');
  if (qtyInput && document.activeElement !== qtyInput) {
    if (item.manual) {
      const hasQuantity = item.quantity !== null && item.quantity !== undefined && item.quantity !== '';
      qtyInput.value = hasQuantity ? String(item.quantity) : '';
    } else {
      const qtyValue = item.quantity != null ? item.quantity : 0;
      qtyInput.value = String(qtyValue);
    }
  }

  const priceInput = row.querySelector('input.price');
  if (priceInput && document.activeElement !== priceInput) {
    const hasPrice = item.price !== null && item.price !== undefined && item.price !== '';
    const priceValue = hasPrice ? toNumber(item.price) : '';
    if (item.manual) {
      priceInput.value = hasPrice ? String(priceValue) : '';
      priceInput.readOnly = false;
    } else {
      const normalizedPrice = toNumber(item.price);
      priceInput.value = Number.isFinite(normalizedPrice) ? normalizedPrice.toFixed(2) : '0.00';
      priceInput.readOnly = !admin;
    }
    priceInput.dataset.price = hasPrice ? String(priceValue) : '';
  }

  const lineOutput = row.querySelector('.mat-line');
  if (lineOutput) {
    if (typeof window !== 'undefined' && typeof window.updateMaterialLine === 'function') {
      window.updateMaterialLine(row, { formatPrice: true, shouldUpdateTotals: false });
    } else {
      const formatted = `${formatCurrency(toNumber(item.price) * toNumber(item.quantity))} kr`;
      if (lineOutput instanceof HTMLInputElement) {
        lineOutput.value = formatted;
      } else {
        lineOutput.textContent = formatted;
      }
    }
  }
}

function calcMaterialesum() {
  return getAllData().reduce((sum, item) => {
    const line = toNumber(item.price) * toNumber(item.quantity);
    return sum + line;
  }, 0);
}

function renderCurrency(target, value) {
  let elements = [];
  if (typeof target === 'string') {
    elements = Array.from(document.querySelectorAll(target));
  } else if (target instanceof Element) {
    elements = [target];
  } else if (target && typeof target.length === 'number') {
    elements = Array.from(target);
  }
  if (elements.length === 0) return;
  const text = `${formatCurrency(value)} kr`;
  elements.forEach(el => {
    el.textContent = text;
  });
}

let totalsUpdateTimer = null;

function computeTraelleTotals() {
  const n35 = toNumber(document.getElementById('traelleloeft35')?.value);
  const n50 = toNumber(document.getElementById('traelleloeft50')?.value);
  const sum = (n35 * TRAELLE_RATE35) + (n50 * TRAELLE_RATE50);
  const state = {
    n35,
    n50,
    RATE35: TRAELLE_RATE35,
    RATE50: TRAELLE_RATE50,
    sum,
  };
  if (typeof window !== 'undefined') {
    window.__traelleloeft = state;
  }
  return state;
}

function performTotalsUpdate() {
  markExportModelDirty();
  const tralleState = computeTraelleTotals();
  const tralleSum = tralleState && Number.isFinite(tralleState.sum) ? tralleState.sum : 0;
  const jobType = document.getElementById('jobType')?.value || 'montage';
  const jobFactor = jobType === 'demontage' ? 0.5 : 1;

  const materialLines = getAllData().map(item => ({
    qty: toNumber(item?.quantity),
    unitPrice: toNumber(item?.price) * jobFactor,
  }));

  const montageBase = calcMaterialesum() + tralleSum;
  const slaebePctInput = toNumber(document.getElementById('slaebePct')?.value);
  const slaebeBelob = montageBase * (Number.isFinite(slaebePctInput) ? slaebePctInput / 100 : 0);

  const ekstraarbejde = {
    tralleløft: tralleSum,
    huller: toNumber(document.getElementById('antalBoringHuller')?.value) * BORING_HULLER_RATE,
    boring: toNumber(document.getElementById('antalBoringBeton')?.value) * BORING_BETON_RATE,
    lukAfHul: toNumber(document.getElementById('antalLukHuller')?.value) * LUK_HULLER_RATE,
    opskydeligt: toNumber(document.getElementById('antalOpskydeligt')?.value) * OPSKYDELIGT_RATE,
    km: toNumber(document.getElementById('km')?.value) * KM_RATE,
    oevrige: 0,
  };

  const workers = Array.isArray(laborEntries)
    ? laborEntries.map(entry => ({
        hours: toNumber(entry?.hours),
        hourlyWithAllowances: toNumber(entry?.rate),
      }))
    : [];
  const totalHours = workers.reduce((sum, worker) => sum + (Number.isFinite(worker.hours) ? worker.hours : 0), 0);

  const totals = calculateTotals({
    materialLines,
    slaebeBelob,
    extra: ekstraarbejde,
    workers,
    totalHours,
  });

  lastMaterialSum = totals.samletAkkordsum;
  lastLoensum = totals.montoerLonMedTillaeg;

  renderCurrency('[data-total="material"]', totals.samletAkkordsum);
  renderCurrency('[data-total="labor"]', totals.montoerLonMedTillaeg);
  renderCurrency('[data-total="project"]', totals.projektsum);

  const montageField = document.getElementById('montagepris');
  if (montageField) {
    montageField.value = montageBase.toFixed(2);
  }
  const demontageField = document.getElementById('demontagepris');
  if (demontageField) {
    demontageField.value = (montageBase * 0.5).toFixed(2);
  }

  updateExportButtonsState();
  scheduleDraftSave();
}

function updateTotals(options = {}) {
  const immediate = options === true || options?.immediate;
  if (immediate) {
    if (totalsUpdateTimer) {
      clearTimeout(totalsUpdateTimer);
      totalsUpdateTimer = null;
    }
    performTotalsUpdate();
    return;
  }

  if (totalsUpdateTimer) {
    clearTimeout(totalsUpdateTimer);
  }
  totalsUpdateTimer = setTimeout(() => {
    totalsUpdateTimer = null;
    performTotalsUpdate();
  }, 80);
}

function updateTotal() {
  updateTotals();
}

function persistDraftSnapshot() {
  if (draftPersistencePaused) return;
  try {
    const snapshot = collectProjectSnapshot();
    if (!snapshot) return;
    const serialized = JSON.stringify(snapshot);
    if (serialized === lastDraftSerialized) return;
    lastDraftSerialized = serialized;
    saveDraft(snapshot);
  } catch (error) {
    console.warn('Kunne ikke gemme kladde', error);
  }
}

function scheduleDraftSave() {
  if (draftPersistencePaused) return;
  if (draftSaveTimer) {
    clearTimeout(draftSaveTimer);
  }
  draftSaveTimer = setTimeout(() => {
    draftSaveTimer = null;
    persistDraftSnapshot();
  }, DRAFT_SAVE_DEBOUNCE);
}

const sagsinfoFieldIds = ['sagsnummer', 'sagsnavn', 'sagsadresse', 'sagskunde', 'sagsdato', 'sagsmontoer'];

function collectSagsinfo() {
  const readValue = id => getDomElement(id)?.value ?? '';
  return {
    sagsnummer: readValue('sagsnummer').trim(),
    navn: readValue('sagsnavn').trim(),
    adresse: readValue('sagsadresse').trim(),
    kunde: readValue('sagskunde').trim(),
    dato: readValue('sagsdato'),
    montoer: readValue('sagsmontoer').trim(),
  };
}

function collectAkkordComment() {
  return getDomElement('akkordComment')?.value || '';
}

function setSagsinfoField(id, value) {
  const el = getDomElement(id);
  if (!el) return;
  if (el.hasAttribute('readonly')) {
    el.removeAttribute('readonly');
  }
  const nextValue = value ?? '';
  const currentValue = el.value;
  if (currentValue !== nextValue) {
    el.value = nextValue;
    ['input', 'change'].forEach(eventName => {
      el.dispatchEvent(new Event(eventName, { bubbles: true }));
    });
  } else {
    el.value = nextValue;
  }
}

function updateActionHint(message = '', variant = 'info') {
  const hint = getDomElement('actionHint');
  if (!hint) return;
  hint.classList.remove('error', 'success');
  if (!message) {
    hint.textContent = DEFAULT_ACTION_HINT;
    hint.style.display = '';
    hint.style.visibility = 'hidden';
    return;
  }
  hint.textContent = message;
  if (variant === 'error') {
    hint.classList.add('error');
  } else if (variant === 'success') {
    hint.classList.add('success');
  }
  hint.style.display = '';
  hint.style.visibility = 'visible';
}

if (typeof window !== 'undefined') {
  window.cssmateUpdateActionHint = updateActionHint;
}


function promisifyRequest(request) {
  if (!request) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDB() {
  if (cachedDBPromise) return cachedDBPromise;
  if (typeof indexedDB === 'undefined') {
    cachedDBPromise = Promise.reject(new Error('IndexedDB er ikke tilgængelig'));
    cachedDBPromise.catch(() => {});
    return cachedDBPromise;
  }
  cachedDBPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = event => {
      const db = event.target?.result;
      if (db && !db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB kunne ikke åbnes'));
  });
  cachedDBPromise.catch(() => {
    cachedDBPromise = null;
  });
  return cachedDBPromise;
}

async function saveProject(data, exportInfo = {}) {
  if (!data) return;
  try {
    const entry = buildHistoryEntryFromSnapshot(data, exportInfo);
    if (!entry) return;
    appendHistoryEntry(entry);
  } catch (error) {
    console.warn('Kunne ikke gemme sag lokalt', error);
  }
}

async function deleteProjectById(id) {
  if (!id) return false;
  try {
    const remaining = deleteHistoryEntry(id);
    recentCasesCache = remaining.map(normalizeHistoryEntry).filter(Boolean);
    syncRecentProjectsGlobal(recentCasesCache);
    return true;
  } catch (error) {
    console.warn('Kunne ikke slette sag', error);
    return false;
  }
}

async function getRecentProjects() {
  try {
    const entries = migrateHistory();
    if (!Array.isArray(entries)) return [];
    const normalized = normalizeHistoryList(entries, historyNormalizeOptions)
      .map(entry => ({
        ...entry,
        caseKey: entry.caseKey || computeHistoryKey(entry) || entry.id,
      }));
    return normalized;
  } catch (error) {
    console.warn('Kunne ikke hente lokale sager', error);
    return [];
  }
}

function setHistoryListBusy(isBusy) {
  const list = getDomElement('historyList');
  if (!list) return;
  list.setAttribute('aria-busy', isBusy ? 'true' : 'false');
  list.classList.toggle('is-loading', Boolean(isBusy));
}

function setupHistorySearch() {
  const controls = document.querySelector('.job-history__controls');
  if (!controls || controls.dataset.historySearch === 'true') return;
  controls.dataset.historySearch = 'true';

  const searchWrapper = document.createElement('div');
  searchWrapper.className = 'history-search';

  const searchLabel = document.createElement('label');
  searchLabel.className = 'history-search__field';
  searchLabel.dataset.historySearch = 'true';
  const label = document.createElement('span');
  label.textContent = 'Søg';
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Søg i historikken…';
  input.autocomplete = 'off';
  const handleInput = debounce(() => {
    historySearchTerm = input.value || '';
    historyVisibleCount = HISTORY_PAGE_SIZE;
    renderHistoryList(recentCasesCache);
  }, 120);
  input.addEventListener('input', handleInput);
  searchLabel.appendChild(label);
  searchLabel.appendChild(input);

  const filters = document.createElement('div');
  filters.className = 'history-search__filters';

  const filterButtons = [
    {
      key: 'recentDays',
      label: 'Seneste 7 dage',
      computeNext: () => (historyFilters.recentDays ? 0 : 7),
    },
    {
      key: 'requireCaseNumber',
      label: 'Kun med sagsnummer',
      computeNext: () => !historyFilters.requireCaseNumber,
    },
    {
      key: 'requireWorkerRates',
      label: 'Kun med timeløn pr. montør',
      computeNext: () => !historyFilters.requireWorkerRates,
    },
  ];

  filterButtons.forEach(config => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'history-search__filter';
    const applyState = () => {
      const isActive = config.key === 'recentDays'
        ? Boolean(historyFilters.recentDays)
        : Boolean(historyFilters[config.key]);
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    };
    button.textContent = config.label;
    button.addEventListener('click', () => {
      historyFilters = { ...historyFilters, [config.key]: config.computeNext() };
      historyVisibleCount = HISTORY_PAGE_SIZE;
      applyState();
      renderHistoryList(recentCasesCache);
    });
    applyState();
    filters.appendChild(button);
  });

  searchWrapper.appendChild(searchLabel);
  searchWrapper.appendChild(filters);
  controls.appendChild(searchWrapper);
}

const formatHistoryTimestamp = value => formatDateLabel(value, {
  timeZone: typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined,
});

function matchesHistorySearch(entry, term) {
  const needle = normalizeSearchValue(term);
  if (!needle) return true;
  const haystack = Array.isArray(entry?.searchValues) ? entry.searchValues : [];
  return haystack.some(value => value && value.includes(needle));
}

function filterHistoryEntries(entries = []) {
  const now = Date.now();
  const hasSearch = Boolean(normalizeSearchValue(historySearchTerm));
  return entries.filter(entry => {
    const normalizedEntry = entry?.displayBaseWage ? entry : normalizeHistoryEntry(entry);
    if (!normalizedEntry) return false;
    if (historyFilters.requireCaseNumber && !normalizeSearchValue(normalizedEntry?.meta?.sagsnummer)) {
      return false;
    }
    const workerCount = Array.isArray(normalizedEntry.perWorker)
      ? normalizedEntry.perWorker.filter(worker => (worker?.rate > 0) || (worker?.base > 0)).length
      : 0;
    const hasBase = Boolean(normalizedEntry?.wage?.base);
    if (historyFilters.requireWorkerRates && !(workerCount || hasBase)) {
      return false;
    }
    if (historyFilters.recentDays > 0) {
      const cutoff = now - (historyFilters.recentDays * 24 * 60 * 60 * 1000);
      const createdAt = normalizedEntry.createdAt || 0;
      if (!createdAt || createdAt < cutoff) return false;
    }
    if (hasSearch && !matchesHistorySearch(normalizedEntry, historySearchTerm)) {
      return false;
    }
    return true;
  });
}

function createHistoryDetailRow(label, value) {
  const row = document.createElement('div');
  row.className = 'history-item__detail';
  const labelEl = document.createElement('span');
  labelEl.className = 'history-item__detail-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'history-item__detail-value';
  valueEl.textContent = value || '–';
  row.append(labelEl, valueEl);
  return row;
}

function buildWorkerRateRows(entry) {
  const container = document.createElement('div');
  container.className = 'history-item__workers';
  const title = document.createElement('div');
  title.className = 'history-item__section-title';
  title.textContent = 'Timeløn pr. montør';
  container.appendChild(title);

  const workers = Array.isArray(entry?.perWorker)
    ? entry.perWorker.filter(worker => (worker?.rate > 0) || (worker?.base > 0))
    : [];

  if (workers.length) {
    workers.forEach(worker => {
      const row = document.createElement('div');
      row.className = 'history-item__worker-row';
      const name = document.createElement('span');
      name.textContent = worker.name || 'Montør';
      const rate = document.createElement('span');
      rate.className = 'history-item__worker-rate';
      const wageValue = worker.base > 0 ? worker.base : worker.rate;
      rate.textContent = wageValue > 0 ? `${formatCurrency(wageValue)} kr/t` : '–';
      row.append(name, rate);
      container.appendChild(row);
    });
  } else {
    const note = document.createElement('p');
    note.className = 'history-item__note';
    note.textContent = entry.displayBaseWage || '–';
    container.appendChild(note);
  }

  return container;
}

function buildWageDetails(entry) {
  const container = document.createElement('div');
  container.className = 'history-item__wages';
  container.appendChild(createHistoryDetailRow('Uden tillæg', entry.display?.base || entry.displayBaseWage || '–'));
  const hasAllowances = [entry.display?.udd1, entry.display?.udd2, entry.display?.udd2Mentor]
    .some(value => value && value !== '–');
  if (hasAllowances) {
    container.appendChild(createHistoryDetailRow('Udd1', entry.display?.udd1 || '–'));
    container.appendChild(createHistoryDetailRow('Udd2', entry.display?.udd2 || '–'));
    container.appendChild(createHistoryDetailRow('Udd2 + mentor', entry.display?.udd2Mentor || '–'));
  } else {
    const note = document.createElement('p');
    note.className = 'history-item__note';
    note.textContent = 'Tillægs-data mangler';
    container.appendChild(note);
  }
  return container;
}

const formatHistoryCurrency = value => new Intl.NumberFormat('da-DK', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(value || 0);

function resolveHistoryTotal (entry = {}) {
  const totals = entry?.totals || entry?.data?.totals || entry?.payload?.totals || {};
  const candidates = [
    totals.projektsum,
    totals.projectTotal,
    totals.total,
    totals.sum,
    totals.projektsumInklMoms,
    totals.projektsumExMoms,
    totals.loensum,
    totals.loensumTotal,
  ];
  for (const candidate of candidates) {
    const num = toNumber(candidate);
    if (num > 0) return num;
  }
  return 0;
}

function buildHistoryListItem(entry) {
  const normalized = entry?.displayBaseWage ? entry : normalizeHistoryEntry(entry);
  if (!normalized) return null;
  const info = deriveSagsinfoFromEntry(normalized);
  const li = document.createElement('li');
  li.className = 'history-item history-row';
  li.dataset.id = normalized.id;

  const header = document.createElement('div');
  header.className = 'history-item__header history-row__summary';
  header.dataset.action = 'toggle-history-row';
  header.dataset.id = normalized.id;
  header.setAttribute('role', 'button');
  header.tabIndex = 0;

  const dateCell = document.createElement('div');
  dateCell.className = 'history-row__cell history-row__cell--date';
  dateCell.textContent = normalized.displayDate || formatHistoryTimestamp(normalized.createdAt);

  const metaCell = document.createElement('div');
  metaCell.className = 'history-row__cell history-row__cell--meta';
  const metaParts = [];
  if (info.sagsnummer) metaParts.push(info.sagsnummer);
  const secondary = [info.navn, info.kunde || info.adresse].filter(Boolean).join(' · ');
  if (secondary) metaParts.push(secondary);
  metaCell.textContent = metaParts.filter(Boolean).join(' — ') || info.adresse || '–';

  const totalCell = document.createElement('div');
  totalCell.className = 'history-row__cell history-row__cell--amount';
  const totalValue = resolveHistoryTotal(normalized);
  totalCell.textContent = totalValue > 0 ? `${formatHistoryCurrency(totalValue)} kr` : '–';

  const actionsCell = document.createElement('div');
  actionsCell.className = 'history-row__cell history-row__cell--actions';
  const loadBtn = document.createElement('button');
  loadBtn.type = 'button';
  loadBtn.dataset.id = normalized.id;
  loadBtn.dataset.action = 'load-history';
  loadBtn.textContent = 'Indlæs';
  actionsCell.append(loadBtn);

  header.append(dateCell, metaCell, totalCell, actionsCell);

  const body = document.createElement('div');
  body.className = 'history-item__body';
  body.hidden = true;

  const infoBlock = document.createElement('div');
  infoBlock.className = 'history-item__info';
  if (info.sagsnummer) infoBlock.appendChild(createHistoryDetailRow('Sagsnr.', info.sagsnummer));
  if (info.navn) infoBlock.appendChild(createHistoryDetailRow('Navn', info.navn));
  if (info.kunde) infoBlock.appendChild(createHistoryDetailRow('Kunde', info.kunde));
  if (infoBlock.children.length) {
    body.appendChild(infoBlock);
  }

  body.appendChild(buildWageDetails(normalized));
  body.appendChild(buildWorkerRateRows(normalized));

  const actions = document.createElement('div');
  actions.className = 'history-item__actions';
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'history-list__delete';
  deleteBtn.dataset.id = normalized.id;
  deleteBtn.dataset.action = 'delete-history';
  deleteBtn.textContent = 'Slet';
  actions.append(deleteBtn);
  body.appendChild(actions);

  const isOpen = openHistoryId && String(openHistoryId) === String(normalized.id);
  header.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  body.hidden = !isOpen;
  if (isOpen) {
    li.classList.add('is-open');
  }

  li.append(header, body);
  return li;
}

function setHistoryRowExpanded(card, expanded) {
  const body = card?.querySelector('.history-item__body');
  const header = card?.querySelector('.history-item__header');
  card?.classList.toggle('is-open', Boolean(expanded));
  if (body) body.hidden = !expanded;
  if (header) header.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

function renderHistoryList(entries = recentCasesCache) {
  const list = getDomElement('historyList');
  if (!list) return;
  list.innerHTML = '';
  const cases = Array.isArray(entries) ? entries : [];
  const filtered = filterHistoryEntries(cases);
  filteredHistoryCache = filtered;
  if (openHistoryId && !filtered.some(entry => String(entry.id) === String(openHistoryId))) {
    openHistoryId = null;
  }
  if (!filtered.length) {
    const empty = document.createElement('li');
    empty.className = 'history-list__empty';
    const hasFilters = normalizeSearchValue(historySearchTerm)
      || historyFilters.recentDays
      || historyFilters.requireCaseNumber
      || historyFilters.requireWorkerRates;
    empty.textContent = hasFilters ? 'Ingen resultater for søgningen.' : 'Ingen historik endnu.';
    list.appendChild(empty);
    setHistoryListBusy(false);
    return;
  }

  const visible = filtered.slice(0, historyVisibleCount);
  const fragment = document.createDocumentFragment();
  visible.forEach(entry => {
    const item = buildHistoryListItem(entry);
    if (item) fragment.appendChild(item);
  });

  if (filtered.length > visible.length) {
    const more = document.createElement('li');
    more.className = 'history-list__more';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `Vis flere (${visible.length}/${filtered.length})`;
    button.addEventListener('click', () => {
      historyVisibleCount += HISTORY_PAGE_SIZE;
      renderHistoryList(entries);
    });
    more.appendChild(button);
    fragment.appendChild(more);
  }

  list.appendChild(fragment);
  setHistoryListBusy(false);
}

function setupHistoryListActions() {
  const list = getDomElement('historyList');
  if (!list || list.dataset.boundDelete === 'true') return;
  list.dataset.boundDelete = 'true';
  list.addEventListener('click', async event => {
    const button = event.target instanceof HTMLElement
      ? event.target.closest('[data-action="delete-history"], [data-action="load-history"], [data-action="toggle-history-row"]')
      : null;
    if (!button) return;
    const action = button.dataset.action;
    const card = button.closest('.history-item');
    const id = button.dataset.id || card?.dataset.id || '';
    if (action === 'toggle-history-row') {
      if (!card || !id) return;
      if (openHistoryId && openHistoryId !== id) {
        const previous = list.querySelector(`.history-item[data-id="${CSS.escape(String(openHistoryId))}"]`);
        if (previous) setHistoryRowExpanded(previous, false);
      }
      const shouldOpen = openHistoryId !== id;
      setHistoryRowExpanded(card, shouldOpen);
      openHistoryId = shouldOpen ? id : null;
      return;
    }
    if (!id) return;
    if (action === 'load-history') {
      await handleLoadCase(id);
      return;
    }
    if (action === 'delete-history') {
      const ok = window.confirm('Er du sikker på, at du vil slette denne sag?');
      if (!ok) return;
      button.disabled = true;
      const deleted = await deleteProjectById(id);
      if (!deleted) {
        button.disabled = false;
        return;
      }
      recentCasesCache = recentCasesCache.filter(entry => String(entry?.id) !== String(id));
      syncRecentProjectsGlobal(recentCasesCache);
      renderHistoryList(recentCasesCache);
      populateRecentCases();
    }
  });

  list.addEventListener('keydown', event => {
    if (!(event.target instanceof HTMLElement)) return;
    if (event.key === 'Enter' || event.key === ' ') {
      const toggle = event.target.closest('[data-action="toggle-history-row"]');
      if (toggle) {
        event.preventDefault();
        toggle.click();
      }
    }
  });
}

function findHistoryEntryById(id) {
  if (!id) return null;
  return recentCasesCache.find(entry => String(entry?.id) === String(id)) || null;
}

function buildHistorySummary(entry) {
  const normalized = entry?.displayBaseWage ? entry : normalizeHistoryEntry(entry);
  if (!normalized) {
    return null;
  }
  const wage = normalized.wage || {};
  const toRateValue = value => {
    if (!value) return 0;
    if (typeof value === 'object' && value != null) {
      return toNumber(value.max || value.min);
    }
    return toNumber(value);
  };
  return {
    date: normalized.displayDateWithAddress || normalized.displayDate || formatHistoryTimestamp(normalized.createdAt),
    timer: toNumber(normalized.hours),
    hourlyBase: toRateValue(wage.base),
    hourlyUdd1: toRateValue(wage.udd1),
    hourlyUdd2: toRateValue(wage.udd2),
    hourlyUdd2Mentor: toRateValue(wage.udd2Mentor),
    display: normalized.display,
    displayHours: normalized.displayHours,
  };
}

function renderJobHistorySummary(entry) {
  const tbody = getDomElement('job-history-summary-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  const summary = buildHistorySummary(entry);
  if (!summary) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    cell.textContent = 'Ingen historik endnu.';
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }
  const formatRate = value => (value > 0 ? `${formatCurrency(value)} kr` : '–');
  const values = [
    summary.date || '–',
    summary.displayHours || (summary.timer > 0 ? formatNumber(summary.timer) : '–'),
    summary.display?.base || formatRate(summary.hourlyBase),
    summary.display?.udd1 || formatRate(summary.hourlyUdd1),
    summary.display?.udd2 || formatRate(summary.hourlyUdd2),
    summary.display?.udd2Mentor || formatRate(summary.hourlyUdd2Mentor),
  ];
  const row = document.createElement('tr');
  values.forEach(text => {
    const cell = document.createElement('td');
    cell.textContent = text;
    row.appendChild(cell);
  });
  tbody.appendChild(row);
}

function updateHistorySummaryFromSelect() {
  const select = getDomElement('jobHistorySelect');
  const selectedId = select?.value;
  let entry = null;
  if (selectedId) {
    entry = findHistoryEntryById(selectedId);
  }
  if (!entry && recentCasesCache.length) {
    entry = recentCasesCache[0];
    if (entry && select && select.value !== String(entry.id)) {
      select.value = String(entry.id);
    }
  }
  renderJobHistorySummary(entry || null);
  const loadBtn = getDomElement('btnLoadHistoryJob');
  if (loadBtn) {
    loadBtn.disabled = !(entry && entry.id != null);
  }
}

async function populateRecentCases() {
  const select = getDomElement('jobHistorySelect');
  const button = getDomElement('btnLoadHistoryJob');
  const hasHistoryUi = Boolean(select || getDomElement('historyList'));
  if (!hasHistoryUi) return;
  setupHistoryListActions();
  setupHistorySearch();
  setHistoryListBusy(true);
  const cases = await getRecentProjects();
  recentCasesCache = cases;
  normalizedHistoryCache = cases;
  filteredHistoryCache = cases;
  historyVisibleCount = HISTORY_PAGE_SIZE;
  syncRecentProjectsGlobal(recentCasesCache);
  const previousValue = select?.value || '';
  if (select) {
    select.innerHTML = '';
  }
  renderHistoryList(cases);

  if (!cases.length) {
    if (select) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Ingen gemte sager endnu';
      option.disabled = true;
      option.selected = true;
      select.appendChild(option);
    }
    if (button) button.disabled = true;
    renderJobHistorySummary(null);
    return;
  }

  if (!select) {
    renderJobHistorySummary(cases[0] || null);
    if (button) {
      button.disabled = !(cases[0] && cases[0].id != null);
    }
    return;
  }

  cases.forEach(entry => {
    const option = document.createElement('option');
    option.value = String(entry.id);
    const info = entry.data?.sagsinfo || {};
    const parts = [];
    if (info.sagsnummer) parts.push(info.sagsnummer);
    if (info.navn) parts.push(info.navn);
    option.textContent = parts.length ? parts.join(' – ') : `Sag #${entry.id}`;
    select.appendChild(option);
  });

  const preferred = cases.find(entry => String(entry.id) === previousValue) || cases[0];
  if (preferred) {
    select.value = String(preferred.id);
  }
  if (button) button.disabled = !(select.value);
  updateHistorySummaryFromSelect();
}

let zipHistoryBound = false;
function setupZipExportHistoryHook() {
  if (zipHistoryBound || typeof window === 'undefined') return;
  zipHistoryBound = true;
  const refreshHistory = () => {
    historyVisibleCount = HISTORY_PAGE_SIZE;
    populateRecentCases();
  };
  window.addEventListener('cssmate:zip-exported', event => {
    const detail = event?.detail || {};
    persistProjectSnapshot({
      type: 'zip',
      ...detail,
    }).finally(refreshHistory);
  });
  window.addEventListener('cssmate:exported', event => {
    if (event?.detail?.historySaved) {
      refreshHistory();
    }
  });
}

function collectExtrasState() {
  const getValue = id => getDomElement(id)?.value ?? '';
  const kmAntal = toNumber(getValue('km'));
  const kmBelob = kmAntal * KM_RATE;
  return {
    jobType: getDomElement('jobType')?.value || 'montage',
    montagepris: getValue('montagepris'),
    demontagepris: getValue('demontagepris'),
    slaebePct: getValue('slaebePct'),
    slaebeFormulaText: exportMeta.slaebFormulaText || '',
    antalBoringHuller: getValue('antalBoringHuller'),
    antalLukHuller: getValue('antalLukHuller'),
    antalBoringBeton: getValue('antalBoringBeton'),
    opskydeligtRaekvaerk: getValue('antalOpskydeligt'),
    km: kmBelob,
    kmBelob,
    kmAntal,
    kmIsAmount: true,
    traelle35: getValue('traelleloeft35'),
    traelle50: getValue('traelleloeft50'),
  };
}

function collectProjectSnapshot(exportInfo) {
  const materials = getAllData().map(item => ({
    id: item.id,
    name: item.name,
    price: toNumber(item.price),
    quantity: toNumber(item.quantity),
    manual: Boolean(item.manual),
    varenr: item.varenr || null,
  }));
  const labor = Array.isArray(laborEntries)
    ? laborEntries.map(entry => ({ ...entry }))
    : [];
  const totals = {
    materialSum: lastMaterialSum,
    laborSum: lastLoensum,
  };
  if (lastJobSummary) {
    totals.timer = lastJobSummary.totalHours;
    totals.hourlyBase = lastJobSummary.hourlyBase;
    totals.hourlyUdd1 = lastJobSummary.hourlyUdd1;
    totals.hourlyUdd2 = lastJobSummary.hourlyUdd2;
    totals.hourlyUdd2Mentor = lastJobSummary.hourlyUdd2Mentor;
    totals.mentorRate = lastJobSummary.mentorRate;
  }

  const now = Date.now();
  const comment = collectAkkordComment();
  const snapshot = {
    timestamp: now,
    sagsinfo: { ...collectSagsinfo(), comment },
    systems: Array.from(selectedSystemKeys),
    materials,
    labor,
    extras: collectExtrasState(),
    totals,
    comment,
  };
  if (exportInfo?.jobPayload) {
    snapshot.payload = exportInfo.jobPayload;
  }
  if (exportInfo && exportInfo.type === 'zip') {
    snapshot.exportInfo = {
      type: 'zip',
      baseName: exportInfo.baseName || '',
      zipName: exportInfo.zipName || '',
      files: Array.isArray(exportInfo.files)
        ? exportInfo.files.filter(Boolean)
        : [],
      exportedAt: exportInfo.timestamp || now,
    };
  }

  return snapshot;
}

function buildHistoryEntryFromSnapshot(snapshot, exportInfo = {}) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const info = deriveSagsinfoFromEntry({ data: snapshot, payload: exportInfo.jobPayload });
  const createdBy = getCachedAuthIdentity();
  const meta = { ...info };
  if (createdBy?.uid) {
    meta.createdByUid = createdBy.uid;
    if (createdBy.email) meta.createdByEmail = createdBy.email;
    if (createdBy.displayName) meta.createdByName = createdBy.displayName;
  }
  const totals = exportInfo.totals || snapshot.totals || {};
  const createdAt = exportInfo.timestamp || snapshot.timestamp || Date.now();
  const timeZone = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
  const tzOffsetMin = new Date(createdAt).getTimezoneOffset();
  return {
    id: exportInfo.id,
    createdAt,
    createdAtMs: createdAt,
    updatedAt: createdAt,
    updatedAtMs: createdAt,
    tzOffsetMin,
    timeZone,
    meta,
    totals,
    payload: exportInfo.jobPayload || snapshot.payload || null,
    source: exportInfo.type || 'export',
    data: snapshot,
  };
}

async function persistProjectSnapshot(exportInfo) {
  if (historyPersistencePaused) return;
  try {
    const snapshot = collectProjectSnapshot(exportInfo);
    const entry = buildHistoryEntryFromSnapshot(snapshot, exportInfo);
    if (!entry) return;
    const saved = appendHistoryEntry(entry);
    const normalized = normalizeHistoryEntry(saved);
    if (normalized) {
      recentCasesCache = [normalized, ...recentCasesCache.filter(item => String(item?.id) !== String(normalized.id))];
      normalizedHistoryCache = recentCasesCache;
      filteredHistoryCache = filterHistoryEntries(normalizedHistoryCache);
      syncRecentProjectsGlobal(recentCasesCache);
      renderHistoryList(recentCasesCache);
    }
    await populateRecentCases();
  } catch (error) {
    console.warn('Kunne ikke gemme projekt snapshot', error);
  }
}

function applyExtrasSnapshot(extras = {}) {
  const assign = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value ?? '';
  };
  const jobType = document.getElementById('jobType');
  if (jobType && extras.jobType) {
    jobType.value = extras.jobType;
  }
  assign('montagepris', extras.montagepris);
  assign('demontagepris', extras.demontagepris);
  assign('slaebePct', extras.slaebePct);
  setSlaebFormulaText(extras?.slaebeFormulaText ?? '');
  updateSlaebFormulaInfo(exportMeta.slaebFormulaText);
  assign('antalBoringHuller', extras.antalBoringHuller);
  assign('antalLukHuller', extras.antalLukHuller);
  assign('antalBoringBeton', extras.antalBoringBeton);
  assign('antalOpskydeligt', extras.opskydeligtRaekvaerk);
  assign('km', resolveKmInputValue(extras, KM_RATE));
  assign('traelleloeft35', extras.traelle35);
  assign('traelleloeft50', extras.traelle50);

  computeTraelleTotals();
}

function applyMaterialsSnapshot(materials = [], systems = []) {
  resetMaterials();
  resetMaterialSearch(false);
  if (Array.isArray(systems) && systems.length) {
    selectedSystemKeys.clear();
    systems.forEach(key => selectedSystemKeys.add(key));
  }
  if (Array.isArray(materials)) {
    materials.forEach(item => {
      if (shouldExcludeMaterialEntry(item)) {
        return;
      }
      const quantity = toNumber(item?.quantity);
      const price = toNumber(item?.price);
      let target = null;
      if (item?.id) {
        target = findMaterialById(item.id);
      }
      if (target && !target.manual) {
        target.quantity = quantity;
        if (Number.isFinite(price) && price > 0) {
          target.price = price;
        }
        return;
      }
      if (item?.manual) {
        const slot = manualMaterials.find(man => man.id === item.id)
          || manualMaterials.find(man => !man.name && man.quantity === 0 && man.price === 0);
        if (slot) {
          slot.name = item.name || slot.name;
          slot.price = Number.isFinite(price) ? price : slot.price;
          slot.quantity = quantity;
          updateMaterialSearchKey(slot);
        }
        return;
      }
      const fallback = manualMaterials.find(man => !man.name && man.quantity === 0 && man.price === 0);
      if (fallback) {
        fallback.name = item?.name || '';
        fallback.price = Number.isFinite(price) ? price : 0;
        fallback.quantity = quantity;
        updateMaterialSearchKey(fallback);
      }
    });
  }
  renderOptaelling();
}

function applyLaborSnapshot(labor = []) {
  if (Array.isArray(labor)) {
    laborEntries = labor.map(entry => ({ ...entry }));
  } else {
    laborEntries = [];
  }
  populateWorkersFromLabor(laborEntries);
}

function extractVersionNumber(payload = {}) {
  const versionValue = payload?.version ?? payload?.meta?.version;
  const numeric = Number(versionValue);
  if (Number.isFinite(numeric)) return numeric;
  if (typeof versionValue === 'string') {
    const parsed = Number.parseFloat(versionValue);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function mapSagsinfoFromPayload(payload = {}) {
  const meta = payload.meta || {};
  const info = payload.info || {};
  return {
    sagsnummer: payload.jobId || info.sagsnummer || meta.sagsnummer || meta.caseNumber || payload.caseNo || payload.id || '',
    navn: payload.jobName || info.navn || meta.caseName || meta.navn || payload.name || payload.title || '',
    adresse: payload.jobAddress || payload.address || payload.site || info.adresse || info.address || meta.adresse || meta.address || '',
    kunde: payload.customer || payload.kunde || info.kunde || info.customer || meta.customer || meta.kunde || '',
    dato: normalizeDateValue(info.dato || info.date || meta.date || payload.createdAt || payload.date),
    montoer: payload.montageWorkers || payload.demontageWorkers || payload.worker || payload.montor || info.montoer || info.montor || meta.montoer || '',
    comment: payload.comment || info.comment || meta.comment || '',
  };
}

function collectMaterialsFromPayload(payload = {}, { defaultSystem = '', priceDivisor = 1 } = {}) {
  let materialsSource = [];
  if (Array.isArray(payload.materials)) {
    materialsSource = payload.materials;
  } else if (Array.isArray(payload.items)) {
    materialsSource = payload.items;
  } else if (Array.isArray(payload.lines)) {
    materialsSource = payload.lines;
  } else if (Array.isArray(payload.linjer)) {
    materialsSource = payload.linjer.map(line => ({
      id: line.varenr,
      name: line.navn,
      quantity: line.antal,
      unitPrice: line.stkPris,
      system: line.system,
    }));
  }

  return materialsSource.map((item, index) => {
    const quantity = toNumber(item.quantity ?? item.qty ?? item.antal ?? item.amount);
    const unitPriceRaw = toNumber(item.unitPrice ?? item.price ?? item.stkPris ?? item.ackUnitPrice ?? item.baseUnitPrice);
    const unitPrice = priceDivisor ? unitPriceRaw / priceDivisor : unitPriceRaw;
    const system = item.system || item.systemKey || payload.system || payload.meta?.system || defaultSystem || inferSystemFromLine(item);
    return {
      id: item.id || item.varenr || item.itemNumber || `line-${index + 1}`,
      name: item.name || item.label || item.title || '',
      quantity,
      price: unitPrice,
      system,
      systemKey: system,
      searchKey: buildSearchKey({ name: item.name || item.label || item.title || '', id: item.id || item.varenr || item.itemNumber, systemKey: system }),
    };
  }).filter(entry => entry && (entry.quantity || entry.name || entry.id));
}

function mapWageToLaborFromPayload(payload = {}, jobType) {
  const wage = payload.wage || {};
  const wageWorkers = Array.isArray(wage.workers)
    ? wage.workers
    : Array.isArray(payload.workers)
      ? payload.workers
      : Array.isArray(payload.labor)
        ? payload.labor
        : [];

  const labor = [];
  if (wageWorkers.length) {
    wageWorkers.forEach(entry => {
      const hours = toNumber(entry?.hours ?? entry?.time);
      const rate = toNumber(entry?.rate ?? entry?.hourlyWithAllowances ?? entry?.hourlyRate);
      const udd = entry?.udd || entry?.education || entry?.educationLevel || wage.educationLevel || '';
      const mentortillaeg = toNumber(entry?.mentortillaeg ?? entry?.mentorAllowance);
      const type = entry?.type || jobType;
      if (hours > 0 || rate > 0 || type) {
        labor.push({ type, hours, rate, udd, mentortillaeg });
      }
    });
  } else {
    const hours = toNumber(wage.montageHours ?? wage.demontageHours ?? wage.totalHours);
    const hourlyRate = toNumber(wage.hourlyRate);
    if (hours > 0 || hourlyRate > 0) {
      labor.push({
        type: jobType,
        hours,
        rate: hourlyRate,
        udd: wage.educationLevel || wage.udd || '',
        mentortillaeg: toNumber(wage.mentorAllowance),
      });
    }
  }

  return labor;
}

function resolveHoleCounts(fieldSet = {}, extrasPayload = {}, extraInputs = {}) {
  const boringHuller = [
    fieldSet.antalBoringHuller,
    fieldSet.huller,
    extrasPayload.antalBoringHuller,
    extrasPayload.huller,
    extraInputs.boringHuller,
  ].find(value => value != null);

  const lukHuller = [
    fieldSet.antalLukHuller,
    extrasPayload.antalLukHuller,
    extraInputs.lukHuller,
    extrasPayload.lukAfHul,
  ].find(value => value != null);

  return {
    antalBoringHuller: toNumber(boringHuller),
    antalLukHuller: toNumber(lukHuller),
  };
}

function mapExtrasForSnapshot(payload = {}, jobType) {
  const extrasPayload = payload.extras || payload.akkord || {};
  const extraInputs = payload.extraInputs || {};
  const fieldSet = extrasPayload.fields || extrasPayload.akkordExtras || extrasPayload.snapshot || {};
  const kmBlock = extrasPayload.km || {};
  const slaebBlock = extrasPayload.slaeb || {};
  const tralleBlock = extrasPayload.tralle || {};
  const kmQuantity = toNumber(kmBlock.quantity ?? extrasPayload.kmAntal ?? extraInputs.km);
  const kmAmount = toNumber(kmBlock.amount ?? extrasPayload.kmBelob ?? extrasPayload.km);
  const { antalBoringHuller, antalLukHuller } = resolveHoleCounts(fieldSet, extrasPayload, extraInputs);

  const extras = {
    jobType,
    montagepris: fieldSet.montagepris ?? extrasPayload.montagepris,
    demontagepris: fieldSet.demontagepris ?? extrasPayload.demontagepris,
    slaebePct: toNumber(slaebBlock.percent ?? fieldSet.slaebePct ?? extrasPayload.slaebePct ?? extraInputs.slaebePctInput),
    slaebeFormulaText: fieldSet.slaebeFormulaText ?? extrasPayload.slaebeFormulaText,
    antalBoringHuller,
    antalLukHuller,
    antalBoringBeton: toNumber(fieldSet.antalBoringBeton ?? extrasPayload.boringBeton ?? extrasPayload.antalBoringBeton ?? extraInputs.boringBeton),
    opskydeligtRaekvaerk: toNumber(fieldSet.opskydeligtRaekvaerk ?? extrasPayload.opskydeligt ?? extrasPayload.opskydeligtRaekvaerk ?? extraInputs.opskydeligt),
    km: kmAmount,
    kmBelob: kmAmount,
    kmAntal: Number.isFinite(kmQuantity) ? kmQuantity : undefined,
    kmIsAmount: true,
    traelle35: toNumber(tralleBlock.lifts35 ?? fieldSet.traelle35 ?? extrasPayload.tralle35 ?? extrasPayload.traelle35),
    traelle50: toNumber(tralleBlock.lifts50 ?? fieldSet.traelle50 ?? extrasPayload.tralle50 ?? extrasPayload.traelle50),
    tralleSum: toNumber(tralleBlock.amount ?? extrasPayload.tralleSum ?? extrasPayload.tralle),
  };

  const mappedInputs = {
    ...extraInputs,
    km: extraInputs.km ?? kmQuantity,
    slaebePctInput: extraInputs.slaebePctInput ?? extras.slaebePct,
    boringHuller: extraInputs.boringHuller ?? extras.antalBoringHuller,
    lukHuller: extraInputs.lukHuller ?? extras.antalLukHuller,
    boringBeton: extraInputs.boringBeton ?? extras.antalBoringBeton,
    opskydeligt: extraInputs.opskydeligt ?? extras.opskydeligtRaekvaerk,
  };

  const extraWork = Array.isArray(extrasPayload.extraWork) ? extrasPayload.extraWork : [];
  if (extraWork.length) {
    extras.extraWork = extraWork;
  }

  return { extras, extraInputs: mappedInputs };
}

function mapAkkordJsonV1ToSnapshot(payload = {}) {
  const jobType = payload.type || payload.extras?.jobType || 'montage';
  const jobFactor = jobType === 'demontage' ? 0.5 : 1;
  const { extras, extraInputs } = mapExtrasForSnapshot(payload, jobType);
  const info = mapSagsinfoFromPayload(payload);
  const systems = Array.isArray(payload.systems) && payload.systems.length
    ? payload.systems
    : payload.system
      ? [payload.system]
      : [];

  const materials = collectMaterialsFromPayload(payload, { defaultSystem: systems[0] || '', priceDivisor: jobFactor || 1 });
  const labor = mapWageToLaborFromPayload(payload, jobType);

  const totals = payload.totals
    ? {
      materialSum: toNumber(payload.totals.materialsSum ?? payload.totals.materialSum),
      laborSum: toNumber(payload.totals.laborSum ?? payload.totals.laborSumWithAllowance),
    }
    : payload.summary
      ? {
        materialSum: toNumber(payload.summary.materialSum),
        laborSum: toNumber(payload.summary.laborSum),
      }
      : undefined;

  return {
    sagsinfo: info,
    systems,
    materials,
    labor,
    extras,
    extraInputs,
    totals,
  };
}

function mapAkkordJsonV2ToSnapshot(payload = {}) {
  const jobType = (payload.jobType || payload.type || payload.meta?.jobType || 'montage').toLowerCase();
  const { extras, extraInputs } = mapExtrasForSnapshot(payload, jobType);
  const info = mapSagsinfoFromPayload(payload);
  const systems = Array.isArray(payload.systems) && payload.systems.length
    ? payload.systems
    : Array.isArray(payload.meta?.systems)
      ? payload.meta.systems
      : payload.meta?.system
        ? [payload.meta.system]
        : payload.system
          ? [payload.system]
          : [];

  const materials = collectMaterialsFromPayload(payload, { defaultSystem: systems[0] || '', priceDivisor: 1 });
  const labor = mapWageToLaborFromPayload(payload, jobType);
  const totals = payload.totals ? { ...payload.totals } : undefined;

  return {
    sagsinfo: info,
    systems,
    materials,
    labor,
    extras,
    extraInputs,
    totals,
  };
}

function normalizeLegacyJsonSnapshot(snapshot = {}) {
  const jobType = snapshot.type || snapshot.jobType || snapshot.extras?.jobType || 'montage';
  const extras = { ...(snapshot.extras || {}), jobType };
  const info = { ...(snapshot.sagsinfo || snapshot.info || {}) };
  if (!info.dato && snapshot.createdAt) {
    info.dato = normalizeDateValue(snapshot.createdAt);
  }

  const systems = Array.isArray(snapshot.systems) ? snapshot.systems : snapshot.system ? [snapshot.system] : [];
  const materials = collectMaterialsFromPayload(snapshot, { defaultSystem: systems[0] || '', priceDivisor: 1 });
  const extraInputs = snapshot.extraInputs || {};
  const labor = Array.isArray(snapshot.labor) ? snapshot.labor : [];

  return {
    sagsinfo: info,
    systems,
    materials,
    labor,
    extras,
    extraInputs,
    totals: snapshot.totals || snapshot.summary,
  };
}

function isCssmateJobSnapshot(payload = {}) {
  return typeof payload?.schemaVersion === 'string' && payload.schemaVersion.startsWith('cssmate.job.');
}

function assertValidCssmateJobSnapshot(payload = {}) {
  if (!isCssmateJobSnapshot(payload)) {
    throw new Error('Ukendt akkordseddel-schema.');
  }
  if (payload.schemaVersion !== 'cssmate.job.v1') {
    throw new Error('Denne version af akkordseddel-formatet understøttes ikke.');
  }
  if (!payload.job || typeof payload.job !== 'object') {
    throw new Error('Manglende job-data i eksporten.');
  }
  const job = payload.job;
  const hasLines = Array.isArray(job.items) || Array.isArray(job.materials) || Array.isArray(job.linjer) || Array.isArray(job.lines);
  if (!hasLines) {
    throw new Error('Eksporten indeholder ingen materialelinjer.');
  }
}

function mapCssmateJobSnapshotToSnapshot(payload = {}) {
  assertValidCssmateJobSnapshot(payload);
  const exportedAt = payload.exportedAt || payload.job?.exportedAt;
  const jobPayload = {
    ...payload.job,
    version: payload.job?.version || '2.0',
    meta: { ...(payload.job?.meta || {}), exportedAt: payload.job?.meta?.exportedAt || exportedAt },
    jobType: payload.job?.jobType || payload.job?.meta?.jobType || payload.job?.type,
    type: payload.job?.jobType || payload.job?.type,
  };
  return mapAkkordJsonV2ToSnapshot(jobPayload);
}

function normalizeImportedJsonSnapshot(snapshot = {}) {
  if (isCssmateJobSnapshot(snapshot)) {
    return mapCssmateJobSnapshotToSnapshot(snapshot);
  }
  const version = extractVersionNumber(snapshot);
  if (Number.isFinite(version) && version >= 2) {
    return mapAkkordJsonV2ToSnapshot(snapshot);
  }
  if (Number.isFinite(version) && version >= 1) {
    return mapAkkordJsonV1ToSnapshot(snapshot);
  }
  return normalizeLegacyJsonSnapshot(snapshot);
}

async function applyProjectSnapshot(snapshot, options = {}) {
  if (!snapshot || typeof snapshot !== 'object') return;
  await ensureMaterialsDataLoad();
  const info = snapshot.sagsinfo || {};
  setSagsinfoField('sagsnummer', info.sagsnummer || '');
  setSagsinfoField('sagsnavn', info.navn || '');
  setSagsinfoField('sagsadresse', info.adresse || '');
  setSagsinfoField('sagskunde', info.kunde || '');
  setSagsinfoField('sagsdato', info.dato || '');
  setSagsinfoField('sagsmontoer', info.montoer || '');
  const commentField = getDomElement('akkordComment');
  if (commentField) {
    commentField.value = info.comment || snapshot.comment || '';
  }

  applyMaterialsSnapshot(snapshot.materials, snapshot.systems);
  const extras = mergeExtrasKm(snapshot.extras || {}, snapshot.extraInputs || {}, KM_RATE);
  applyExtrasSnapshot(extras);
  applyLaborSnapshot(snapshot.labor);

  if (snapshot.totals) {
    if (Number.isFinite(snapshot.totals.materialSum)) {
      lastMaterialSum = snapshot.totals.materialSum;
    }
    if (Number.isFinite(snapshot.totals.laborSum)) {
      lastLoensum = snapshot.totals.laborSum;
    }
  }

  updateTotals(true);
  validateSagsinfo();
  if (!options?.skipHint) {
    updateActionHint('Sag er indlæst.', 'success');
  }
}

async function handleLoadCase(idFromClick) {
  const select = getDomElement('jobHistorySelect');
  const value = idFromClick || select?.value;
  if (!value) return;
  let record = recentCasesCache.find(entry => String(entry.id) === String(value));
  if (!record) {
    const cases = await getRecentProjects();
    recentCasesCache = cases;
    syncRecentProjectsGlobal(recentCasesCache);
    record = cases.find(entry => String(entry.id) === String(value));
    renderHistoryList(recentCasesCache);
  }
  pauseHistoryPersistence();
  try {
    const payload = record?.payload || record?.data || null;
    const snapshot = payload ? normalizeImportedJsonSnapshot(payload) : record?.data;
    if (snapshot) {
      await applyProjectSnapshot(snapshot, { skipHint: false });
      renderJobHistorySummary(record);
      saveDraft(snapshot);
      lastDraftSerialized = JSON.stringify(snapshot);
      if (select) {
        select.value = String(record.id);
      }
    } else {
      updateActionHint('Kunne ikke indlæse den valgte sag.', 'error');
    }
  } finally {
    resumeHistoryPersistence();
  }
}

function computeSagsinfoValidity() {
  let isValid = true;
  const invalidIds = [];
  sagsinfoFieldIds.forEach(id => {
    const el = getDomElement(id);
    if (!el) return;
    const rawValue = (el.value || '').trim();
    let fieldValid = rawValue.length > 0;
    if (id === 'sagsdato') {
      const parsed = Date.parse(rawValue);
      fieldValid = rawValue.length > 0 && !Number.isNaN(parsed);
    }
    if (!fieldValid) {
      isValid = false;
      invalidIds.push(id);
    }
  });
  return { isValid, invalidIds };
}

function hasValidExportData() {
  if (lastExportModel && Array.isArray(lastExportModel.items) && lastExportModel.items.length > 0) {
    return true;
  }
  const allData = getAllData();
  if (Array.isArray(allData) && allData.some(item => toNumber(item?.quantity) > 0)) {
    return true;
  }
  return Number.isFinite(lastMaterialSum) && lastMaterialSum > 0;
}

function hasValidExportState(forceSagsinfoValid) {
  const sagsinfoValid = typeof forceSagsinfoValid === 'boolean'
    ? forceSagsinfoValid
    : computeSagsinfoValidity().isValid;
  const jobTypeValue = (document.getElementById('jobType')?.value || '').trim();
  const jobTypeValid = jobTypeValue.length > 0;
  const dataReady = hasValidExportData();
  return sagsinfoValid && jobTypeValid && dataReady;
}

function updateExportButtons(forceSagsinfoValid) {
  const pdfBtn = document.getElementById('btn-export-akkord-pdf');
  const printBtn = document.getElementById('btn-print-akkord');
  const enabled = hasValidExportState(forceSagsinfoValid);

  [pdfBtn, printBtn].forEach(btn => {
    if (btn) {
      btn.disabled = !enabled;
      btn.setAttribute('aria-disabled', String(!enabled));
    }
  });
}

function updateExportButtonsState(forceSagsinfoValid) {
  updateExportButtons(forceSagsinfoValid);
}

function markExportModelDirty() {
  lastExportModel = null;
}

function validateSagsinfo() {
  markExportModelDirty();
  const validity = computeSagsinfoValidity();
  sagsinfoFieldIds.forEach(id => {
    const el = getDomElement(id);
    if (!el) return;
    const fieldValid = !validity.invalidIds.includes(id);
    el.classList.toggle('invalid', !fieldValid);
  });

  updateExportButtonsState(validity.isValid);

  if (validity.isValid) {
    updateActionHint('');
  } else {
    updateActionHint(DEFAULT_ACTION_HINT, 'error');
  }

  return validity.isValid;
}

function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[";\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sanitizeFilename(value) {
  return (value || 'akkordseddel')
    .toString()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9-_]+/gi, '_');
}

function formatNumberForCSV(value) {
  return toNumber(value).toFixed(2).replace('.', ',');
}

function formatPercentForCSV(value) {
  const num = toNumber(value);
  return `${num.toFixed(2).replace('.', ',')} %`;
}

function collectJobType() {
  return document.getElementById('jobType')?.value || 'montage';
}

function handleJobTypeChange(event) {
  const selectedType = (event?.target?.value || collectJobType() || '').toLowerCase();
  if (selectedType === 'demontage') {
    const boringField = document.getElementById('antalBoringHuller');
    const lukField = document.getElementById('antalLukHuller');
    if (boringField && lukField) {
      const lukRaw = (lukField.value ?? '').trim();
      const lukNumeric = toNumber(lukRaw);
      const hasLukValue = lukRaw !== '' && lukNumeric !== 0;
      if (!hasLukValue) {
        const boringRaw = (boringField.value ?? '').trim();
        if (boringRaw) {
          const normalized = toNumber(boringRaw);
          lukField.value = Number.isFinite(normalized) ? String(normalized) : boringRaw;
        }
      }
    }
  }
  updateTotals(true);
  updateExportButtonsState();
}

function formatDateForDisplay(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isNaN(date.valueOf())) {
    return date.toLocaleDateString('da-DK');
  }
  return String(value);
}

function triggerBlobDownload(blob, fileName) {
  if (!blob || !fileName) return;
  downloadBlob(blob, fileName);
}

function inferSystemFromLine(line) {
  if (!line) return '';
  if (line.system) return line.system;
  if (line.systemKey) return line.systemKey;
  const rawId = String(line.varenr || line.id || '').trim().toLowerCase();
  if (rawId.startsWith('b')) return 'bosta';
  if (rawId.startsWith('h')) return 'haki';
  if (rawId.startsWith('m')) return 'modex';
  return '';
}

function buildAkkordJobSnapshot(data = lastEkompletData) {
  const source = data || lastEkompletData;
  if (!source) return null;
  const formInfo = collectSagsinfo();
  const info = { ...(source.sagsinfo || {}), ...formInfo };
  const jobType = source.jobType || document.getElementById('jobType')?.value || 'montage';
  const workerNames = info.montoer || '';
  const montageNames = jobType === 'demontage' ? '' : workerNames;
  const demontageNames = jobType === 'demontage' ? workerNames : '';
  const formattedDate = info.dato ? formatDateForDisplay(info.dato) : '';
  const systems = Array.isArray(source.systems) ? source.systems : (source.system ? [source.system] : []);
  const job = {
    id: info.sagsnummer || info.navn || info.adresse || 'akkord',
    caseNo: info.sagsnummer || '',
    site: info.adresse || '',
    address: info.adresse || '',
    task: info.navn || '',
    title: info.navn || '',
    customer: info.kunde || '',
    date: formattedDate || info.dato || '',
    montageWorkers: montageNames,
    demontageWorkers: demontageNames,
    montor: workerNames,
    worker: workerNames,
    system: systems[0] || getSelectedSystemKeys()[0] || '',
  };

  const materialLines = Array.isArray(source.materialer) ? source.materialer : [];
  const normalized = materialLines
    .map(line => ({
      id: line?.varenr || line?.id || '',
      label: line?.name || line?.label || '',
      name: line?.name || line?.label || '',
      qty: toNumber(line?.quantity ?? line?.qty ?? 0),
      amount: toNumber(line?.quantity ?? line?.qty ?? 0),
      system: inferSystemFromLine(line),
    }))
    .filter(line => line.label && line.qty > 0);

  job.lines = normalized;
  job.items = normalized;
  job.materials = normalized;
  return job;
}

function buildRawAkkordData(options = {}) {
  const info = collectSagsinfo();
  if (options.customSagsnummer) {
    info.sagsnummer = options.customSagsnummer;
  }
  const comment = collectAkkordComment();

  const materials = getAllData().filter(item => toNumber(item.quantity) > 0);
  const labor = Array.isArray(laborEntries) ? laborEntries : [];
  const cache = typeof window !== 'undefined' ? window.__beregnLonCache : null;
  const jobType = collectJobType();
  const jobFactor = jobType === 'demontage' ? 0.5 : 1;

  const extraInputs = {
    boringHuller: toNumber(document.getElementById('antalBoringHuller')?.value),
    lukHuller: toNumber(document.getElementById('antalLukHuller')?.value),
    boringBeton: toNumber(document.getElementById('antalBoringBeton')?.value),
    opskydeligt: toNumber(document.getElementById('antalOpskydeligt')?.value),
    km: toNumber(document.getElementById('km')?.value),
    slaebePctInput: toNumber(document.getElementById('slaebePct')?.value),
  };

  const tralleState = computeTraelleTotals();
  const tralleSum = tralleState && Number.isFinite(tralleState.sum) ? tralleState.sum : 0;
  const materialLinesForTotals = materials.map(item => ({
    qty: toNumber(item.quantity),
    unitPrice: toNumber(item.price) * jobFactor,
  }));

  const montageBase = calcMaterialesum() + tralleSum;
  const slaebePct = Number.isFinite(extraInputs.slaebePctInput) ? (extraInputs.slaebePctInput / 100) : 0;
  const slaebeBelob = montageBase * slaebePct;

  const ekstraarbejdeModel = {
    tralleløft: tralleSum,
    traelle35: tralleState?.n35 || 0,
    traelle50: tralleState?.n50 || 0,
    huller: extraInputs.boringHuller * BORING_HULLER_RATE,
    lukAfHul: extraInputs.lukHuller * LUK_HULLER_RATE,
    boringBeton: extraInputs.boringBeton * BORING_BETON_RATE,
    boring: extraInputs.boringBeton * BORING_BETON_RATE,
    opskydeligt: extraInputs.opskydeligt * OPSKYDELIGT_RATE,
    km: extraInputs.km * KM_RATE,
    oevrige: 0,
    slaebePct: extraInputs.slaebePctInput,
    slaebeBelob,
  };

  const extras = mergeExtrasKm({
    jobType,
    slaebePct: extraInputs.slaebePctInput,
    slaebeBelob,
    slaebeFormulaText: exportMeta.slaebFormulaText || '',
    antalBoringHuller: extraInputs.boringHuller,
    antalLukHuller: extraInputs.lukHuller,
    antalBoringBeton: extraInputs.boringBeton,
    boringBeton: ekstraarbejdeModel.boring,
    boring: ekstraarbejdeModel.boring,
    huller: ekstraarbejdeModel.huller,
    lukAfHul: ekstraarbejdeModel.lukAfHul,
    opskydeligtRaekvaerk: extraInputs.opskydeligt,
    opskydeligt: ekstraarbejdeModel.opskydeligt,
    km: ekstraarbejdeModel.km,
    kmBelob: ekstraarbejdeModel.km,
    kmAntal: extraInputs.km,
    kmIsAmount: true,
    traelle35: tralleState?.n35 || 0,
    traelle50: tralleState?.n50 || 0,
    tralleløft: tralleSum,
  }, extraInputs, KM_RATE);

  const laborTotals = labor.map(entry => ({
    hours: toNumber(entry?.hours),
    hourlyWithAllowances: toNumber(entry?.rate),
    udd: entry?.udd || '',
    mentortillaeg: toNumber(entry?.mentortillaeg),
  }));
  const totalHours = laborTotals.reduce((sum, worker) => sum + (Number.isFinite(worker.hours) ? worker.hours : 0), 0);
  const totals = calculateTotals({
    materialLines: materialLinesForTotals,
    slaebeBelob,
    extra: ekstraarbejdeModel,
    workers: laborTotals,
    totalHours,
  });

  const sagsnummer = info.sagsnummer || 'akkordseddel';
  const meta = {
    sagsnummer,
    dato: info.dato || new Date().toISOString(),
    kunde: info.kunde,
    adresse: info.adresse,
    navn: info.navn,
    systems: Array.from(selectedSystemKeys),
    createdAt: new Date().toISOString(),
    comment,
  };

  return {
    version: '1.0',
    info,
    materials,
    labor,
    cache,
    jobType,
    jobFactor,
    systems: Array.from(selectedSystemKeys),
    comment,
    tralleState,
    tralleSum,
    materialLinesForTotals,
    montageBase,
    slaebePctInput: extraInputs.slaebePctInput,
    slaebeBelob,
    extraInputs,
    extras,
    laborTotals,
    totalHours,
    totals,
    meta,
    createdAt: meta.createdAt,
  };
}

if (typeof window !== 'undefined') {
  window.cssmateBuildAkkordDataRaw = buildRawAkkordData
}

function buildAkkordData(options = {}) {
  const raw = buildRawAkkordData(options)
  const model = buildSharedAkkordData(raw)
  lastExportModel = model
  return model
}

if (typeof window !== 'undefined') {
  window.cssmateBuildAkkordData = buildAkkordData
}

function syncActiveJobState() {
  const job = buildAkkordJobSnapshot();
  if (job) {
    setActiveJob(job);
  }
  return job;
}

function normalizeDateValue(value) {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/[-\/.]/);
  if (parts.length === 3) {
    const [a, b, c] = parts;
    if (a.length === 4) {
      return `${a}-${b.padStart(2, '0')}-${c.padStart(2, '0')}`;
    }
    if (c.length === 4) {
      return `${c}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`;
    }
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.valueOf())) {
    return parsed.toISOString().slice(0, 10);
  }
  return '';
}

function parseCSV(text) {
  const lines = String(text).split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) return [];
  const delimiter = lines[0].includes(';') ? ';' : ',';

  const parseLine = (line) => {
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    cells.push(current.trim());
    return cells;
  };

  const headers = parseLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    if (values.every(cell => cell === '')) continue;
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });
    rows.push(row);
  }
  return rows;
}

function resetMaterials() {
  [dataBosta, dataHaki, dataModex, dataAlfix].forEach(list => {
    list.forEach(item => {
      item.quantity = 0;
    });
  });
  manualMaterials.forEach(item => {
    item.name = '';
    item.price = 0;
    item.quantity = 0;
    item.searchKey = '';
  });
}

function resetWorkers() {
  workerCount = 0;
  const container = document.getElementById('workers');
  if (container) {
    container.innerHTML = '';
  }
}

function populateWorkersFromLabor(entries) {
  resetWorkers();
  if (!Array.isArray(entries) || entries.length === 0) {
    addWorker();
    updateTotals(true);
    return;
  }

  entries.forEach((entry, index) => {
    addWorker();
    const worker = document.getElementById(`worker${index + 1}`);
    if (!worker) return;

    const hoursInput = worker.querySelector('.worker-hours');
    const tillaegInput = worker.querySelector('.worker-tillaeg');
    const uddSelect = worker.querySelector('.worker-udd');

    if (hoursInput) {
      hoursInput.value = formatNumber(toNumber(entry.hours));
    }
    if (tillaegInput) {
      tillaegInput.value = formatNumber(toNumber(entry.mentortillaeg));
    }
    if (uddSelect instanceof HTMLSelectElement) {
      const savedValue = (entry?.udd ?? '').toString().trim();
      if (savedValue) {
        const hasOption = Array.from(uddSelect.options).some(option => option.value === savedValue);
        if (hasOption) {
          uddSelect.value = savedValue;
        } else if (uddSelect.options.length > 0) {
          uddSelect.selectedIndex = 0;
        }
      } else if (uddSelect.options.length > 0) {
        uddSelect.selectedIndex = 0;
      }
    }
  });

  updateTotals(true);
  const hasRegisteredHours = entries.some(entry => toNumber(entry.hours) > 0);
  if (hasRegisteredHours && typeof beregnLon === 'function') {
    beregnLon();
  }
}

function matchMaterialByName(name) {
  if (!name) return null;
  const targetKey = normalizeKey(name);
  const allLists = [dataBosta, dataHaki, dataModex, dataAlfix, manualMaterials];
  for (const list of allLists) {
    const match = list.find(item => normalizeKey(item.name) === targetKey);
    if (match) return match;
  }
  return null;
}

function assignMaterialRow(row) {
  const idValue = row.id?.trim?.() || '';
  const nameValue = row.name?.trim?.() || '';
  const qty = toNumber(row.quantity);
  const price = toNumber(row.price);
  if (!nameValue && !idValue && qty === 0 && price === 0) return;

  if (shouldExcludeMaterialEntry({ id: idValue, name: nameValue })) {
    return;
  }

  let target = null;
  if (idValue) {
    target = findMaterialById(idValue);
  }
  if (!target && nameValue) {
    target = matchMaterialByName(nameValue);
  }

  if (target && !target.manual) {
    target.quantity = qty;
    if (price > 0) target.price = price;
    return;
  }

  const receiver = manualMaterials.find(item => !item.name && item.quantity === 0 && item.price === 0);
  if (!receiver) return;
  const manualIndex = manualMaterials.indexOf(receiver) + 1;
  receiver.name = nameValue || receiver.name || `Manuelt materiale ${manualIndex}`;
  receiver.quantity = qty;
  receiver.price = price;
}

function applyCSVRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  resetMaterials();

  const info = collectSagsinfo();
  const montorValues = [];
  const materials = [];
  const labor = [];

  rows.forEach(row => {
    const normalized = {};
    Object.entries(row).forEach(([key, value]) => {
      normalized[normalizeKey(key)] = (value ?? '').toString().trim();
    });

    const sagsnummerVal = normalized['sagsnummer'] || normalized['sagsnr'] || normalized['sag'] || normalized['caseid'];
    if (sagsnummerVal) info.sagsnummer = sagsnummerVal;

    const navnVal = normalized['navnopgave'] || normalized['navn'] || normalized['opgave'] || normalized['projekt'];
    if (navnVal) info.navn = navnVal;

    const adresseVal = normalized['adresse'] || normalized['addresse'];
    if (adresseVal) info.adresse = adresseVal;

    const kundeVal = normalized['kunde'] || normalized['customer'];
    if (kundeVal) info.kunde = kundeVal;

    const datoVal = normalizeDateValue(normalized['dato'] || normalized['date']);
    if (datoVal) info.dato = datoVal;

    const montorVal = normalized['montoer'] || normalized['montor'] || normalized['montornavne'] || normalized['montornavn'];
    if (montorVal) montorValues.push(montorVal);

    const matName = normalized['materialenavn'] || normalized['materiale'] || normalized['varenavn'] || normalized['navn'];
    const matQty = normalized['antal'] || normalized['quantity'] || normalized['qty'] || normalized['maengde'];
    const matPrice = normalized['pris'] || normalized['price'] || normalized['enhedspris'] || normalized['stkpris'];
    const matId = normalized['id'] || normalized['materialeid'] || normalized['varenummer'];
    if (matName || matId || matQty || matPrice) {
      materials.push({ id: matId, name: matName, quantity: matQty, price: matPrice });
    }

    const laborType = normalized['arbejdstype'] || normalized['type'] || normalized['jobtype'];
    const laborHours = normalized['timer'] || normalized['hours'] || normalized['antalttimer'];
    const laborRate = normalized['sats'] || normalized['rate'] || normalized['timelon'] || normalized['timeloen'];
    if (laborType || laborHours || laborRate) {
      labor.push({ type: laborType || '', hours: toNumber(laborHours), rate: toNumber(laborRate) });
    }
  });

  setSagsinfoField('sagsnummer', info.sagsnummer || '');
  setSagsinfoField('sagsnavn', info.navn || '');
  setSagsinfoField('sagsadresse', info.adresse || '');
  setSagsinfoField('sagskunde', info.kunde || '');
  setSagsinfoField('sagsdato', info.dato || '');

  if (montorValues.length) {
    const names = montorValues
      .flatMap(value => value.split(/[\n,]/))
      .map(name => name.trim())
      .filter(Boolean)
      .join('\n');
    setSagsinfoField('sagsmontoer', names);
  }

  materials.forEach(assignMaterialRow);

  const systemsWithQuantities = systemOptions.filter(option =>
    option.dataset.some(item => toNumber(item.quantity) > 0)
  );
  if (systemsWithQuantities.length > 0) {
    selectedSystemKeys.clear();
    systemsWithQuantities.forEach(option => selectedSystemKeys.add(option.key));
  }

  renderOptaelling();

  laborEntries = labor.filter(entry => entry.hours > 0 || entry.rate > 0 || entry.type);
  populateWorkersFromLabor(laborEntries);
  updateTotals(true);

  if (laborEntries.length > 0) {
    const firstType = laborEntries[0].type?.toLowerCase() || '';
    const jobSelect = document.getElementById('jobType');
    if (jobSelect) {
      if (firstType.includes('demo')) jobSelect.value = 'demontage';
      else if (firstType.includes('montage')) jobSelect.value = 'montage';
    }
  }

  validateSagsinfo();
}

function setupCSVImport() {
  const dropArea = document.getElementById('dropArea');
  const fileInput = document.getElementById('csvFileInput');
  if (!dropArea || !fileInput) return;

  const openPicker = () => fileInput.click();

  ['dragenter', 'dragover'].forEach(evt => {
    dropArea.addEventListener(evt, event => {
      event.preventDefault();
      dropArea.classList.add('dragover');
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    });
  });

  ['dragleave', 'dragend'].forEach(evt => {
    dropArea.addEventListener(evt, () => dropArea.classList.remove('dragover'));
  });

  dropArea.addEventListener('drop', event => {
    event.preventDefault();
    dropArea.classList.remove('dragover');
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      handleImportFile(file);
      fileInput.value = '';
    }
  });

  dropArea.addEventListener('click', openPicker);
  dropArea.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPicker();
    }
  });

  fileInput.addEventListener('change', event => {
    const file = event.target.files?.[0];
    if (file) {
      handleImportFile(file);
      fileInput.value = '';
    }
  });
}

async function resetCurrentJob() {
  pauseHistoryPersistence();
  pauseDraftPersistence();
  try {
    await ensureMaterialsDataLoad();
    clearDraft();
    lastDraftSerialized = '';
    selectedSystemKeys.clear();
    resetMaterials();
    resetMaterialSearch(false);
    renderOptaelling();
    laborEntries = [];
    resetWorkers();
    addWorker();
    sagsinfoFieldIds.forEach(id => setSagsinfoField(id, ''));
    applyExtrasSnapshot({ jobType: 'montage' });
    const jobTypeSelect = document.getElementById('jobType');
    if (jobTypeSelect) {
      jobTypeSelect.value = 'montage';
    }
    lastMaterialSum = 0;
    lastLoensum = 0;
    lastJobSummary = null;
    updateTotals(true);
    validateSagsinfo();
    updateActionHint('Ny sag klar.', 'success');
  } finally {
    resumeDraftPersistence();
    resumeHistoryPersistence();
  }
}

async function applyImportedAkkordData(data, options = {}) {
  const actionHint = typeof options.updateActionHint === 'function' ? options.updateActionHint : updateActionHint;
  if (!data || typeof data !== 'object') {
    actionHint('Kunne ikke læse akkordseddel-data.', 'error');
    return;
  }
  const payload = data.data && !data.materials ? data.data : data;
  const applySnapshot = typeof options.applySnapshot === 'function' ? options.applySnapshot : applyProjectSnapshot;
  const persistSnapshot = typeof options.persistSnapshot === 'function' ? options.persistSnapshot : () => Promise.resolve();
  const materialFields = {
    materials: Array.isArray(payload.materials),
    lines: Array.isArray(payload.lines),
    linjer: Array.isArray(payload.linjer),
    items: Array.isArray(payload.items),
  };
  console.info('Forsøger at læse materialer fra import', materialFields);

  const snapshot = normalizeImportedJsonSnapshot(payload);
  const materials = Array.isArray(snapshot?.materials) ? snapshot.materials : [];
  const normalizedMaterials = materials
    .map(normalizeMaterialLine)
    .filter(Boolean);
  if (!normalizedMaterials.length) {
    const message = 'Kunne ikke læse nogen linjer fra filen.';
    const availableFields = Object.keys(materialFields).filter(key => materialFields[key]);
    console.warn('Ingen materialer fundet i import', { availableFields, materialFields });
    actionHint(message, 'error');
    throw new Error(message);
  }

  const normalizedJobType = (snapshot.extras?.jobType || snapshot.extraInputs?.jobType || payload.jobType || payload.type || 'montage').toLowerCase();
  const systemsFromPayload = Array.isArray(snapshot.systems) ? snapshot.systems : [];
  const systemsFromMaterials = normalizedMaterials
    .map(line => normalizeSystemId(line.system))
    .filter(Boolean);
  const normalizedSystems = Array.from(new Set([
    ...systemsFromPayload.map(normalizeSystemId).filter(Boolean),
    ...systemsFromMaterials,
  ]));
  const systems = normalizedSystems.length
    ? normalizedSystems
    : Array.from(selectedSystemKeys);

  const extras = { ...(snapshot.extras || {}), jobType: normalizedJobType };
  const extraInputs = snapshot.extraInputs || {};

  const normalizedSnapshot = {
    ...snapshot,
    systems,
    materials: normalizedMaterials,
    extras,
    extraInputs,
    totals: snapshot.totals || payload.totals || {},
  };

  pauseHistoryPersistence();
  try {
    await applySnapshot(normalizedSnapshot, { skipHint: true });
  } finally {
    resumeHistoryPersistence();
  }

  markExportModelDirty();
  actionHint('Akkordseddel er importeret. Bekræft arbejdstype og tal.', 'success');
  updateExportButtonsState();
  persistSnapshot({ type: 'import', source: payload?.meta?.source || 'json' });
}

async function handleAkkordImport(file) {
  if (!file) return;
  try {
    const text = await file.text();
    if (!text || !text.trim()) {
      throw new Error('Importfilen er tom eller uden indhold.');
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error('Ugyldig JSON-fil. Kunne ikke læse eksporten.');
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Importfilen har et ukendt format.');
    }
    await applyImportedAkkordData(parsed);
  } catch (error) {
    console.error('Kunne ikke importere akkordseddel', error);
    const message = error?.message || 'Kunne ikke importere akkordseddel-filen.';
    updateActionHint(message, 'error');
    throw error;
  }
}

if (typeof window !== 'undefined') {
  window.cssmateHandleAkkordImport = handleAkkordImport;
}

export { applyImportedAkkordData };

function normalizeSystemId(value) {
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (value && typeof value.name === 'string') return value.name.trim().toLowerCase();
  if (value && typeof value.id === 'string') return value.id.trim().toLowerCase();
  return '';
}

function normalizeMaterialLine(line) {
  if (!line || typeof line !== 'object') return null;
  const quantity = toImportNumber(line.qty ?? line.quantity ?? line.antal, 0);
  const system = normalizeSystemId(line.system);
  const unitPrice = toImportNumber(line.unitPrice ?? line.price ?? line.pris, line.unitPrice ?? line.price ?? line.pris ?? 0);
  const normalized = {
    ...line,
    id: line.id || line.itemNumber || line.item || line.key || '',
    name: line.name || line.title || line.navn || '',
    quantity,
    qty: quantity,
    unitPrice,
    system,
  };
  return normalized;
}

function toImportNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  const fallbackNumber = Number(fallback);
  return Number.isFinite(fallbackNumber) ? fallbackNumber : 0;
}

function handleImportFile(file) {
  if (!file) return;
  const fileName = file.name || '';
  if (/\.json$/i.test(fileName) || (file.type && file.type.includes('json'))) {
    importJSONProject(file);
    return;
  }
  uploadCSV(file);
}

// --- Authentication ---
async function verifyAdminCodeInput(value, tenantConfig = null) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    return { ok: false, reason: 'empty' };
  }

  const plainCandidates = new Set([
    ...KNOWN_ADMIN_CODES,
    ...(Array.isArray(tenantConfig?.KNOWN_ADMIN_CODES) ? tenantConfig.KNOWN_ADMIN_CODES : []),
    ...(Array.isArray(tenantConfig?.admin_codes_plain) ? tenantConfig.admin_codes_plain : [])
  ].filter(code => typeof code === 'string' && code.trim().length));

  for (const code of plainCandidates) {
    if (code === trimmed) {
      return { ok: true, method: 'plaintext' };
    }
  }

  const hashedCandidates = new Set([
    ...KNOWN_ADMIN_CODE_HASHES,
    DEFAULT_ADMIN_CODE_HASH,
    tenantConfig?._meta?.admin_code,
    ...(Array.isArray(tenantConfig?.HASHED_ADMIN_CODES) ? tenantConfig.HASHED_ADMIN_CODES : [])
  ].filter(hash => typeof hash === 'string' && hash.length));

  if (hashedCandidates.size > 0) {
    const digest = await sha256Hex(trimmed);
    for (const expected of hashedCandidates) {
      if (constantTimeEquals(digest, expected)) {
        return { ok: true, method: 'sha256' };
      }
    }
  }

  return { ok: false, reason: 'no_match' };
}

function handleAdminLogout(feedback) {
  admin = false;
  setAdminOk(false);
  renderOptaelling();
  updateTotals(true);
  if (feedback) {
    feedback.textContent = 'Admin-tilstand er slået fra.';
    feedback.classList.remove('error');
    feedback.classList.add('success');
    feedback.removeAttribute('hidden');
  }
  updateActionHint('Admin-tilstand er slået fra.', 'success');
}

async function handleAdminLogin() {
  const codeInput = document.getElementById('adminCode');
  const feedback = document.getElementById('adminFeedback');
  if (!codeInput) return;

  const trimmed = codeInput.value.trim();
  if (!trimmed) {
    if (isAdminUnlocked()) {
      handleAdminLogout(feedback);
    } else if (feedback) {
      feedback.textContent = 'Indtast admin-kode for at logge ind.';
      feedback.classList.remove('success');
      feedback.classList.add('error');
      feedback.removeAttribute('hidden');
    }
    return;
  }

  const validation = await verifyAdminCodeInput(trimmed);
  if (validation.ok) {
    admin = true;
    setAdminOk(true); // Update admin state for click guard
    codeInput.value = '';
    feedback?.classList.remove('error');
    feedback?.classList.add('success');
    if (feedback) {
      feedback.textContent = 'Admin-tilstand aktiveret. Prisfelter er nu redigerbare.';
      feedback.removeAttribute('hidden');
    }
    renderOptaelling();
    updateTotals(true);
  } else if (feedback) {
    feedback.textContent = 'Forkert kode. Prøv igen.';
    feedback.classList.remove('success');
    feedback.classList.add('error');
    feedback.removeAttribute('hidden');
  }
}

function setupAdminLoginButton () {
  const adminLoginButton = document.getElementById('btnAdminLogin')
  if (!adminLoginButton) return
  adminLoginButton.addEventListener('click', event => {
    event.preventDefault()
    handleAdminLogin()
  })
}

// --- Worker Functions ---
function ensureWorkersInitialized() {
  if (workerCount > 0) return
  const container = document.getElementById('workers')
  if (!container) return
  const existing = container.querySelector('.worker-row')
  if (existing) {
    workerCount = container.querySelectorAll('.worker-row').length
    return
  }
  addWorker()
}

function addWorker() {
  workerCount++;
  const w = document.createElement("fieldset");
  w.className = "worker-row";
  w.id = `worker${workerCount}`;
  w.innerHTML = `
    <legend>Mand ${workerCount}</legend>
    <div class="worker-grid">
      <label>
        <span>Timer</span>
        <input type="text" class="worker-hours" value="0" inputmode="decimal" data-numpad="true" data-decimal="comma" data-numpad-field="worker-hours-${workerCount}">
      </label>
      <label>
        <span>Uddannelse</span>
        <select class="worker-udd">
          <option value="udd1">Udd1 (42,98 kr)</option>
          <option value="udd2">Udd2 (49,38 kr)</option>
        </select>
      </label>
      <label>
        <span>Mentortillæg (22,26 kr/t)</span>
        <input type="text" class="worker-tillaeg" value="0" inputmode="decimal" data-numpad="true" data-decimal="comma" data-numpad-field="worker-tillaeg-${workerCount}">
      </label>
    </div>
    <div class="worker-output" aria-live="polite"></div>
  `;
  document.getElementById("workers").appendChild(w);
}


// Debounce funktion til performance
function debounce(func, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), delay);
  };
}

// Async storage helpers
async function saveLocalData(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

async function loadLocalData(key) {
  const data = localStorage.getItem(key);
  return data ? JSON.parse(data) : null;
}

function showLonOutputSections() {
  if (lonOutputsRevealed) return;
  lonOutputsRevealed = true;
  const sections = document.querySelectorAll('[data-lon-output]');
  sections.forEach(section => {
    section.hidden = false;
    section.removeAttribute('hidden');
  });
  updateExportButtonsState();
}

function beregnLon() {
  ensureWorkersInitialized();
  const info = collectSagsinfo();
  const sagsnummer = info.sagsnummer?.trim() || 'uspecified';
  const jobType = document.getElementById('jobType')?.value || 'montage';
  const jobFactor = jobType === 'demontage' ? 0.5 : 1;
  const selectedSystems = getSelectedSystemKeys();
  const normalizedPrimarySystem = selectedSystems
    .map(value => normalizeKey(value))
    .find(value => ['bosta', 'haki', 'modex'].includes(value)) || '';
  const slaebePctInput = toNumber(document.getElementById('slaebePct')?.value);
  const antalBoringHuller = toNumber(document.getElementById('antalBoringHuller')?.value);
  const antalLukHuller = toNumber(document.getElementById('antalLukHuller')?.value);
  const antalBoringBeton = toNumber(document.getElementById('antalBoringBeton')?.value);
  const antalOpskydeligt = toNumber(document.getElementById('antalOpskydeligt')?.value);
  const antalKm = toNumber(document.getElementById('km')?.value);
  const workers = document.querySelectorAll('.worker-row');

  lastEkompletData = null;
  lastJobSummary = null;

  const tralleState = computeTraelleTotals();
  const traelleSum = tralleState && Number.isFinite(tralleState.sum) ? tralleState.sum : 0;

  const calcMaterialLines = [];
  const materialLines = [];
  const materialerTilEkomplet = [];
  const allData = getAllData();
  if (Array.isArray(allData)) {
    allData.forEach(item => {
      const qty = toNumber(item?.quantity);
      if (qty <= 0) return;
      const basePrice = toNumber(item?.price);
      const ackUnitPrice = basePrice * jobFactor;
      const lineTotal = qty * ackUnitPrice;
      calcMaterialLines.push({ qty, unitPrice: ackUnitPrice });
      const manualIndex = manualMaterials.indexOf(item);
      const label = item?.manual ? (item.name?.trim() || `Manuelt materiale ${manualIndex + 1}`) : item?.name;
      materialLines.push({
        label,
        quantity: qty,
        unitPrice: basePrice,
        lineTotal,
        ackUnitPrice,
      });
      const adjustedUnitPrice = qty > 0 ? lineTotal / qty : ackUnitPrice;
      materialerTilEkomplet.push({
        varenr: item?.varenr || item?.id || '',
        name: label,
        quantity: qty,
        unitPrice: adjustedUnitPrice,
        baseUnitPrice: basePrice,
        lineTotal,
        system: item?.systemKey || '',
        systemKey: item?.systemKey || '',
      });
    });
  }

  const boringHullerTotal = antalBoringHuller * BORING_HULLER_RATE;
  const lukHullerTotal = antalLukHuller * LUK_HULLER_RATE;
  const boringBetonTotal = antalBoringBeton * BORING_BETON_RATE;
  const opskydeligtTotal = antalOpskydeligt * OPSKYDELIGT_RATE;
  const kilometerPris = antalKm * KM_RATE;

  const montageBase = calcMaterialesum() + traelleSum;
  const slaebePct = Number.isFinite(slaebePctInput) ? slaebePctInput / 100 : 0;
  const slaebebelob = montageBase * slaebePct;

  const ekstraarbejdeModel = {
    tralleløft: traelleSum,
    huller: boringHullerTotal,
    boring: boringBetonTotal,
    lukAfHul: lukHullerTotal,
    opskydeligt: opskydeligtTotal,
    km: kilometerPris,
    oevrige: 0,
  };

  let samletTimer = 0;
  workers.forEach(worker => {
    const hoursEl = worker.querySelector('.worker-hours');
    const hours = toNumber(hoursEl?.value);
    if (hours > 0) {
      samletTimer += hours;
    }
  });

  if (samletTimer === 0) {
    const resultatDiv = document.getElementById('lonResult');
    if (resultatDiv) {
      resultatDiv.innerHTML = '';
      const message = document.createElement('div');
      message.style.color = 'red';
      message.textContent = 'Indtast arbejdstimer for mindst én person';
      resultatDiv.appendChild(message);
    }
    laborEntries = [];
    lastJobSummary = null;
    return;
  }

  const totalsBaseInput = {
    materialLines: calcMaterialLines,
    slaebeBelob: slaebebelob,
    extra: ekstraarbejdeModel,
    workers: [],
    totalHours: samletTimer,
  };

  const totalsWithoutLabor = calculateTotals(totalsBaseInput);
  const akkordTimeLøn = totalsWithoutLabor.timeprisUdenTillaeg;
  const samletAkkordSum = totalsWithoutLabor.samletAkkordsum;

  const workerLines = [];
  const beregnedeArbejdere = [];
  const workersForTotals = [];

  workers.forEach((worker, index) => {
    const hours = toNumber(worker.querySelector('.worker-hours')?.value);
    if (hours <= 0) return;
    const mentortillaeg = toNumber(worker.querySelector('.worker-tillaeg')?.value);
    const uddSelect = worker.querySelector('.worker-udd');
    const udd = uddSelect?.value || '';
    const workerName = worker.querySelector('legend')?.textContent?.trim() || `Mand ${index + 1}`;
    const outputEl = worker.querySelector('.worker-output');

    let timelon = akkordTimeLøn + mentortillaeg;
    let uddannelsesTillaeg = 0;
    if (udd === 'udd1') {
      timelon += TILLAEG_UDD1;
      uddannelsesTillaeg = TILLAEG_UDD1;
    } else if (udd === 'udd2') {
      timelon += TILLAEG_UDD2;
      uddannelsesTillaeg = TILLAEG_UDD2;
    }

    const total = timelon * hours;
    if (outputEl) {
      outputEl.textContent = `${timelon.toFixed(2)} kr/t | Total: ${total.toFixed(2)} kr`;
    }
    workerLines.push({
      name: workerName,
      hours,
      rate: timelon,
      total,
    });
    const uddLabel = uddSelect?.selectedOptions?.[0]?.textContent?.trim() || '';
    beregnedeArbejdere.push({
      id: index + 1,
      name: workerName,
      type: jobType,
      hours,
      rate: timelon,
      baseRate: akkordTimeLøn,
      mentortillaeg,
      udd,
      uddLabel,
      uddannelsesTillaeg,
      total,
    });
    workersForTotals.push({ hours, hourlyWithAllowances: timelon });
  });

  const totals = calculateTotals({
    ...totalsBaseInput,
    workers: workersForTotals,
  });

  const safeBaseHourly = Number.isFinite(totals.timeprisUdenTillaeg) ? totals.timeprisUdenTillaeg : 0;
  const hasBaseHourly = safeBaseHourly > 0;
  lastJobSummary = {
    totalHours: samletTimer,
    hourlyBase: hasBaseHourly ? safeBaseHourly : 0,
    hourlyUdd1: hasBaseHourly ? safeBaseHourly + TILLAEG_UDD1 : 0,
    hourlyUdd2: hasBaseHourly ? safeBaseHourly + TILLAEG_UDD2 : 0,
    hourlyUdd2Mentor: hasBaseHourly ? safeBaseHourly + TILLAEG_UDD2 + DEFAULT_MENTOR_RATE : 0,
    mentorRate: DEFAULT_MENTOR_RATE,
  };

  const samletUdbetalt = totals.montoerLonMedTillaeg;
  const materialSumInfo = totals.materialer + totals.slaeb;
  const projektsum = totals.projektsum;
  const datoDisplay = formatDateForDisplay(info.dato);

  const resultatDiv = document.getElementById('lonResult');
  if (resultatDiv) {
    resultatDiv.innerHTML = '';

    const sagsSection = document.createElement('div');
    const sagsHeader = document.createElement('h3');
    sagsHeader.textContent = 'Sagsinfo';
    sagsSection.appendChild(sagsHeader);

    const fields = [
      { label: 'Sagsnr.', value: info.sagsnummer || '' },
      { label: 'Navn', value: info.navn || '' },
      { label: 'Adresse', value: info.adresse || '' },
      { label: 'Dato', value: datoDisplay },
    ];

    fields.forEach(({ label, value }) => {
      const line = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = `${label}: `;
      line.appendChild(strong);
      const span = document.createElement('span');
      span.textContent = value;
      line.appendChild(span);
      sagsSection.appendChild(line);
    });

    resultatDiv.appendChild(sagsSection);

    const matHeader = document.createElement('h3');
    matHeader.textContent = 'Materialer brugt:';
    resultatDiv.appendChild(matHeader);

    if (materialLines.length > 0) {
      materialLines.forEach(lineItem => {
        const line = document.createElement('div');
        line.textContent = `${lineItem.label}: ${lineItem.quantity} × ${lineItem.unitPrice.toFixed(2)} kr = ${lineItem.lineTotal.toFixed(2)} kr`;
        resultatDiv.appendChild(line);
      });
    } else {
      const none = document.createElement('div');
      none.textContent = 'Ingen materialer brugt';
      resultatDiv.appendChild(none);
    }

    const workersHeader = document.createElement('h3');
    workersHeader.textContent = 'Arbejdere:';
    resultatDiv.appendChild(workersHeader);

    if (workerLines.length > 0) {
      workerLines.forEach(workerLine => {
        const line = document.createElement('div');
        line.className = 'worker-payline';
        line.textContent = `${workerLine.name}: Timer: ${workerLine.hours}, Timeløn: ${workerLine.rate.toFixed(2)} kr/t, Total: ${workerLine.total.toFixed(2)} kr`;
        resultatDiv.appendChild(line);
      });
    } else {
      const none = document.createElement('div');
      none.textContent = 'Ingen timer registreret';
      resultatDiv.appendChild(none);
    }

    const oversigtHeader = document.createElement('h3');
    oversigtHeader.textContent = 'Oversigt:';
    resultatDiv.appendChild(oversigtHeader);

    const oversigt = [
      ['Materialer', `${totals.materialer.toFixed(2)} kr`],
      ['Ekstraarbejde', `${totals.ekstraarbejde.toFixed(2)} kr`],
      ['Slæb', `${totals.slaeb.toFixed(2)} kr`],
      ['Samlet akkordsum', `${totals.samletAkkordsum.toFixed(2)} kr`],
      ['Timer', `${samletTimer.toFixed(1)} t`],
      ['Timepris (uden tillæg)', `${totals.timeprisUdenTillaeg.toFixed(2)} kr/t`],
      ['Lønsum', `${totals.montoerLonMedTillaeg.toFixed(2)} kr`],
      ['Projektsum', `${projektsum.toFixed(2)} kr`],
      ['Materialesum (info)', `${materialSumInfo.toFixed(2)} kr`],
      ['Kilometer (info)', `${kilometerPris.toFixed(2)} kr`],
      ['Tralleløft (info)', `${traelleSum.toFixed(2)} kr`],
    ];

    oversigt.forEach(([label, value]) => {
      const line = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = `${label}: `;
      line.appendChild(strong);
      const span = document.createElement('span');
      span.textContent = value;
      line.appendChild(span);
      resultatDiv.appendChild(line);
    });

  }

  laborEntries = beregnedeArbejdere;

  lastEkompletData = {
    sagsinfo: info,
    jobType,
    montagepris: montageBase,
    demontagepris: montageBase * 0.5,
    systems: selectedSystems,
    primarySystem: normalizedPrimarySystem,
    extras: {
      slaebePct: slaebePctInput,
      slaebeBelob: slaebebelob,
      slaebeFormulaText: exportMeta.slaebFormulaText || '',
      boringHuller: { antal: antalBoringHuller, pris: BORING_HULLER_RATE, total: boringHullerTotal },
      lukHuller: { antal: antalLukHuller, pris: LUK_HULLER_RATE, total: lukHullerTotal },
      boringBeton: { antal: antalBoringBeton, pris: BORING_BETON_RATE, total: boringBetonTotal },
      opskydeligtRaekvaerk: { antal: antalOpskydeligt, pris: OPSKYDELIGT_RATE, total: opskydeligtTotal },
      kilometer: { antal: antalKm, pris: KM_RATE, total: kilometerPris },
      traelleloeft: {
        antal35: tralleState?.n35 || 0,
        pris35: TRAELLE_RATE35,
        total35: (tralleState?.n35 || 0) * TRAELLE_RATE35,
        antal50: tralleState?.n50 || 0,
        pris50: TRAELLE_RATE50,
        total50: (tralleState?.n50 || 0) * TRAELLE_RATE50,
        total: traelleSum,
      },
    },
    materialer: materialerTilEkomplet,
    arbejdere: beregnedeArbejdere,
    totals: {
      materialer: totals.materialer,
      ekstraarbejde: totals.ekstraarbejde,
      kilometerPris,
      slaebeBelob: totals.slaeb,
      akkordsum: totals.samletAkkordsum,
      timer: samletTimer,
      akkordTimeLon: totals.timeprisUdenTillaeg,
      loensum: totals.montoerLonMedTillaeg,
      projektsum,
      materialeSumInfo: materialSumInfo,
      traelleSum,
    },
    traelle: {
      antal35: tralleState?.n35 || 0,
      antal50: tralleState?.n50 || 0,
      rate35: TRAELLE_RATE35,
      rate50: TRAELLE_RATE50,
      sum: traelleSum,
    },
  };

  syncActiveJobState();
  updateTotals(true);

  if (typeof window !== 'undefined') {
    window.__cssmateLastEkompletData = lastEkompletData;
    window.__beregnLonCache = {
      materialSum: lastMaterialSum,
      laborSum: lastLoensum,
      projectSum: lastMaterialSum + lastLoensum,
      traelleSum,
      timestamp: Date.now(),
    };
  }

  showLonOutputSections();
  try {
    if (typeof buildAkkordData === 'function') {
      buildAkkordData();
    }
  } catch (err) {
    console.warn('Kunne ikke opdatere eksportdata', err);
  }
  if (typeof updateExportButtonsState === 'function') {
    updateExportButtonsState();
  }
  return sagsnummer;
}


// --- CSV-eksport ---
function buildCSVPayload(customSagsnummer, options = {}) {
  if (!options?.skipValidation && !validateSagsinfo()) {
    updateActionHint('Udfyld Sagsinfo for at eksportere.', 'error');
    return null;
  }
  if (!options?.skipBeregn) {
    beregnLon();
  }
  const info = collectSagsinfo();
  if (customSagsnummer) {
    info.sagsnummer = customSagsnummer;
  }
  const cache = typeof window !== 'undefined' ? window.__beregnLonCache : null;
  const materials = getAllData().filter(item => toNumber(item.quantity) > 0);
  const labor = Array.isArray(laborEntries) ? laborEntries : [];
  const tralleState = computeTraelleTotals();
  const tralleSum = tralleState && Number.isFinite(tralleState.sum) ? tralleState.sum : 0;
  const jobType = document.getElementById('jobType')?.value || 'montage';
  const jobFactor = jobType === 'demontage' ? 0.5 : 1;
  const materialLinesForTotals = materials.map(item => ({
    qty: toNumber(item.quantity),
    unitPrice: toNumber(item.price) * jobFactor,
  }));
  const montageBase = calcMaterialesum() + tralleSum;
  const slaebePctInput = toNumber(document.getElementById('slaebePct')?.value);
  const slaebeBelob = montageBase * (Number.isFinite(slaebePctInput) ? slaebePctInput / 100 : 0);
  const antalBoringHuller = toNumber(document.getElementById('antalBoringHuller')?.value);
  const antalBoringBeton = toNumber(document.getElementById('antalBoringBeton')?.value);
  const antalLukHuller = toNumber(document.getElementById('antalLukHuller')?.value);
  const antalOpskydeligt = toNumber(document.getElementById('antalOpskydeligt')?.value);
  const antalKm = toNumber(document.getElementById('km')?.value);

  const ekstraarbejdeModel = {
    tralleløft: tralleSum,
    huller: antalBoringHuller * BORING_HULLER_RATE,
    boring: antalBoringBeton * BORING_BETON_RATE,
    lukAfHul: antalLukHuller * LUK_HULLER_RATE,
    opskydeligt: antalOpskydeligt * OPSKYDELIGT_RATE,
    km: antalKm * KM_RATE,
    oevrige: 0,
  };
  const laborTotals = labor.map(entry => ({
    hours: toNumber(entry?.hours),
    hourlyWithAllowances: toNumber(entry?.rate),
  }));
  const totalHours = laborTotals.reduce((sum, worker) => sum + (Number.isFinite(worker.hours) ? worker.hours : 0), 0);
  const totalsFallback = calculateTotals({
    materialLines: materialLinesForTotals,
    slaebeBelob,
    extra: ekstraarbejdeModel,
    workers: laborTotals,
    totalHours,
  });

  const materialSum = cache && Number.isFinite(cache.materialSum)
    ? cache.materialSum
    : totalsFallback.materialer;
  const extraSum = totalsFallback.ekstraarbejde;
  const haulSum = totalsFallback.slaeb;
  const laborSum = cache && Number.isFinite(cache.laborSum)
    ? cache.laborSum
    : totalsFallback.montoerLonMedTillaeg;
  const projectSum = cache && Number.isFinite(cache.projectSum)
    ? cache.projectSum
    : totalsFallback.projektsum;

  const lines = [];
  lines.push('Sektion;Felt;Værdi;Antal;Pris;Linjesum');
  lines.push(`Sagsinfo;Sagsnummer;${escapeCSV(info.sagsnummer)};;;`);
  lines.push(`Sagsinfo;Navn/opgave;${escapeCSV(info.navn)};;;`);
  lines.push(`Sagsinfo;Adresse;${escapeCSV(info.adresse)};;;`);
  lines.push(`Sagsinfo;Kunde;${escapeCSV(info.kunde)};;;`);
  lines.push(`Sagsinfo;Dato;${escapeCSV(info.dato)};;;`);
  const montorText = (info.montoer || '').replace(/\r?\n/g, ', ');
  lines.push(`Sagsinfo;Montørnavne;${escapeCSV(montorText)};;;`);

  lines.push('');
  lines.push('Sektion;Id;Materiale;Antal;Pris;Linjesum');
  if (materials.length === 0) {
    lines.push('Materiale;;;0;0,00;0,00');
  } else {
    materials.forEach(item => {
      const qty = toNumber(item.quantity);
      if (qty === 0) return;
      const price = toNumber(item.price);
      const total = qty * price;
      const manualIndex = manualMaterials.indexOf(item);
      const label = item.manual ? (item.name?.trim() || `Manuelt materiale ${manualIndex + 1}`) : item.name;
      lines.push(`Materiale;${escapeCSV(item.id)};${escapeCSV(label)};${escapeCSV(formatNumberForCSV(qty))};${escapeCSV(formatNumberForCSV(price))};${escapeCSV(formatNumberForCSV(total))}`);
    });
  }

  const tralle = window.__traelleloeft;
  if (tralle && (tralle.n35 > 0 || tralle.n50 > 0)) {
    if (tralle.n35 > 0) {
      const total35 = tralle.n35 * tralle.RATE35;
      lines.push(`Materiale;TL35;Tralleløft 0,35 m;${escapeCSV(formatNumberForCSV(tralle.n35))};${escapeCSV(formatNumberForCSV(tralle.RATE35))};${escapeCSV(formatNumberForCSV(total35))}`);
    }
    if (tralle.n50 > 0) {
      const total50 = tralle.n50 * tralle.RATE50;
      lines.push(`Materiale;TL50;Tralleløft 0,50 m;${escapeCSV(formatNumberForCSV(tralle.n50))};${escapeCSV(formatNumberForCSV(tralle.RATE50))};${escapeCSV(formatNumberForCSV(total50))}`);
    }
  }

  lines.push('');
  lines.push('Sektion;Arbejdstype;Timer;Sats;Linjesum');
  if (labor.length === 0) {
    lines.push('Løn;Ingen registrering;;;');
  } else {
    labor.forEach((entry, index) => {
      const hours = toNumber(entry.hours);
      const rate = toNumber(entry.rate);
      const total = hours * rate;
      const type = entry.type || `Arbejdstype ${index + 1}`;
      lines.push(`Løn;${escapeCSV(type)};${escapeCSV(formatNumberForCSV(hours))};${escapeCSV(formatNumberForCSV(rate))};${escapeCSV(formatNumberForCSV(total))}`);
    });
  }

  lines.push('');
  lines.push('Sektion;Total;Beløb');
  lines.push(`Total;Materialesum;${escapeCSV(formatNumberForCSV(materialSum))}`);
  if (extraSum > 0) {
    lines.push(`Total;Ekstraarbejde;${escapeCSV(formatNumberForCSV(extraSum))}`);
  }
  if (haulSum > 0) {
    lines.push(`Total;Slæb;${escapeCSV(formatNumberForCSV(haulSum))}`);
  }
  lines.push(`Total;Lønsum;${escapeCSV(formatNumberForCSV(laborSum))}`);
  lines.push(`Total;Projektsum;${escapeCSV(formatNumberForCSV(projectSum))}`);
  const formulaNote = (exportMeta.slaebFormulaText || '').trim();
  if (formulaNote) {
    lines.push(`Noter;A9 slæb-formel;${escapeCSV(exportMeta.slaebFormulaText)}`);
  }

  const content = lines.join('\n');
  const baseName = sanitizeFilename(info.sagsnummer || 'akkordseddel') || 'akkordseddel';
  return {
    content,
    baseName,
    fileName: `${baseName}.csv`,
    originalName: info.sagsnummer,
  };
}

if (typeof window !== 'undefined') {
  window.cssmateBuildCSVPayload = buildCSVPayload;
}

// --- Akkordseddel JSON-eksport ---
/**
 * Akkordseddel JSON-format (v2)
 * {
 *   version: '2.0',
 *   source: 'cssmate',
 *   meta: { caseNumber, caseName, customer, address, date, system, systems, jobType, jobFactor, createdAt, exportedAt },
 *   info: { sagsnummer, navn, adresse, kunde, dato, montoer, jobType },
 *   items: [{ lineNumber, system, category, itemNumber, name, unit, quantity, unitPrice, lineTotal }],
 *   extras: {
 *     km: { quantity, rate, amount },
 *     slaeb: { percent, amount },
 *     tralle: { lifts35, lifts50, amount },
 *     extraWork: [...],
 *     fields: { kmBelob, kmAntal, kmIsAmount, slaebePct, montagepris, demontagepris, antalBoringHuller, antalLukHuller, antalBoringBeton, opskydeligtRaekvaerk, traelle35, traelle50, tralleSum, jobType }
 *   },
 *   wage: { workers: [...], totals: { hours, sum } },
 *   extraInputs: {...},
 *   totals: { materials, extras, extrasBreakdown, akkord, project }
 * }
 */
const AKKORD_JSON_VERSION = '2.0';

function buildAkkordJsonPayload(customSagsnummer, options = {}) {
  if (!options?.skipValidation && !validateSagsinfo()) {
    updateActionHint('Udfyld Sagsinfo for at eksportere.', 'error');
    return null;
  }
  if (!options?.skipBeregn) {
    beregnLon();
  }

  const data = options?.data || buildAkkordData({ customSagsnummer });
  const {
    info,
    materials,
    labor,
    jobType,
    jobFactor,
    extras,
    laborTotals: laborTotalsRaw,
    totalHours: totalHoursRaw,
    totals,
    extraInputs,
    tralleState,
    tralleSum,
    createdAt,
    systems: dataSystems,
    meta: dataMeta,
    comment: dataComment,
  } = data;

  const systems = Array.isArray(dataSystems) && dataSystems.length
    ? dataSystems
    : Array.isArray(dataMeta?.systems)
      ? dataMeta.systems
      : Array.from(selectedSystemKeys);
  const comment = dataComment || dataMeta?.comment || info?.comment || '';

  const laborList = Array.isArray(labor) ? labor : [];
  const laborTotals = Array.isArray(laborTotalsRaw)
    ? laborTotalsRaw
    : laborList.map(entry => ({
      hours: toNumber(entry?.hours),
      hourlyWithAllowances: toNumber(entry?.rate),
      udd: entry?.udd || '',
      mentortillaeg: toNumber(entry?.mentortillaeg),
    }));
  const totalHours = Number.isFinite(totalHoursRaw)
    ? totalHoursRaw
    : laborTotals.reduce((sum, worker) => sum + (Number.isFinite(worker.hours) ? worker.hours : 0), 0);

  const infoPayload = {
    sagsnummer: info.sagsnummer || '',
    navn: info.navn || '',
    adresse: info.adresse || '',
    kunde: info.kunde || '',
    dato: info.dato || '',
    montoer: info.montoer || '',
    comment,
  };

  const exportModel = buildSharedExportModel({
    ...data,
    jobType,
    jobFactor,
    extras,
    extraInputs: extraInputs || {},
    totals,
    tralleState: tralleState || {},
    tralleSum: tralleSum || 0,
    createdAt: createdAt || data.createdAt || new Date().toISOString(),
    systems,
    comment,
  }, { exportedAt: new Date().toISOString() });

  const infoFields = exportModel.info || infoPayload;
  const baseName = sanitizeFilename([
    infoFields.sagsnummer || 'akkordseddel',
    infoFields.kunde || '',
    (infoFields.dato || '').slice(0, 10),
  ].filter(Boolean).join('-')) || 'akkordseddel';

  const payload = {
    ...exportModel,
    jobType: jobType,
  };

  return {
    content: JSON.stringify(payload, null, 2),
    baseName,
    fileName: `${baseName}.json`,
    data: payload,
  };
}

function exposeExportHelpers () {
  if (typeof window === 'undefined') return
  window.cssmateBuildAkkordJsonPayload = (options = {}) => {
    if (typeof options === 'string') {
      return buildAkkordJsonPayload(options, {})
    }
    const { customSagsnummer, ...rest } = options || {}
    return buildAkkordJsonPayload(customSagsnummer, rest)
  }
  window.cssmateExportPDFBlob = exportPDFBlob
}

// --- PDF-eksport (html2canvas + jsPDF) ---
async function exportPDFBlob(customSagsnummer, options = {}) {
  if (!options?.skipValidation && !validateSagsinfo()) {
    updateActionHint('Udfyld Sagsinfo for at eksportere.', 'error');
    return null;
  }
  if (!options?.skipBeregn) {
    beregnLon();
  }
  const data = options?.data || buildAkkordData({ customSagsnummer });
  const {
    info,
    materials,
    labor,
    extras,
    tralleState,
    tralleSum,
    slaebePctInput,
    slaebeBelob,
    laborTotals,
    totalHours,
    totals,
    cache,
    extraInputs,
  } = data;

  const materialSum = cache && Number.isFinite(cache.materialSum)
    ? cache.materialSum
    : totals.materialer;
  const extraSum = totals.ekstraarbejde;
  const haulSum = totals.slaeb;
  const laborSum = cache && Number.isFinite(cache.laborSum)
    ? cache.laborSum
    : totals.montoerLonMedTillaeg;
  const projectSum = cache && Number.isFinite(cache.projectSum)
    ? cache.projectSum
    : totals.projektsum;

  const wrapper = document.createElement('div');
  wrapper.className = 'export-preview';
  wrapper.style.position = 'fixed';
  wrapper.style.left = '-9999px';
  wrapper.style.top = '0';
  wrapper.style.background = '#ffffff';
  wrapper.style.color = '#000000';
  wrapper.style.padding = '24px';
  wrapper.style.width = '794px';
  wrapper.style.boxSizing = 'border-box';

  const workerCountDisplay = laborTotals.filter(entry => Number.isFinite(entry.hours) && entry.hours > 0).length;
  const fmtHours = value => new Intl.NumberFormat('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);

  function formatReviewValue(row) {
    switch (row.format) {
      case 'currency': {
        const amount = `${formatCurrency(row.value)} kr`;
        if (!row.info) return amount;
        let infoText = '';
        if (row.info.type === 'percent') {
          infoText = `${formatNumber(row.info.percent)} %`;
        } else if (row.info.type === 'qtyPrice') {
          const qtyLabel = row.info.unitLabel ? `${formatNumber(row.info.qty)} ${row.info.unitLabel}` : formatNumber(row.info.qty);
          infoText = `${qtyLabel} × ${formatCurrency(row.info.unitPrice)} kr`;
        } else if (row.info.type === 'trolley') {
          const qtyText = row.info.qty ? `${formatNumber(row.info.qty)} løft` : '';
          const entryText = Array.isArray(row.info.entries)
            ? row.info.entries
              .filter(entry => entry && Number(entry.qty) > 0)
              .map(entry => `${formatNumber(entry.qty)} × ${formatCurrency(entry.unitPrice)} kr`)
              .join(' · ')
            : '';
          infoText = [qtyText, entryText].filter(Boolean).join(' · ');
        }
        return infoText ? `${amount} (${infoText})` : amount;
      }
      case 'hours':
        return `${fmtHours(row.value)} t`;
      case 'team': {
        const count = Number(row.value?.workersCount) || 0;
        const hours = fmtHours(row.value?.hours || 0);
        if (!count) return `${hours} t`;
        const label = count === 1 ? '1 medarbejder' : `${count} medarbejdere`;
        return `${label} · ${hours} t`;
      }
      default:
        return '';
    }
  }

  const antalBoringHuller = extraInputs.boringHuller;
  const antalLukHuller = extraInputs.lukHuller;
  const antalBoringBeton = extraInputs.boringBeton;
  const antalOpskydeligt = extraInputs.opskydeligt;
  const antalKm = extraInputs.km;

  const reviewRows = [
    { id: 'materials', label: '1. Materialer', format: 'currency', value: materialSum },
    { id: 'extraWork', label: '2. Ekstra arbejde', format: 'currency', value: extraSum },
    { id: 'extra-sled', label: '   Slæb', format: 'currency', value: slaebeBelob, subtle: true, info: { type: 'percent', percent: slaebePctInput } },
    { id: 'extra-km', label: '   Kilometer', format: 'currency', value: extras.km, subtle: true, info: { type: 'qtyPrice', qty: antalKm, unitPrice: KM_RATE, unitLabel: 'km' } },
    { id: 'extra-holes', label: '   Boring af huller', format: 'currency', value: extras.huller, subtle: true, info: { type: 'qtyPrice', qty: antalBoringHuller, unitPrice: BORING_HULLER_RATE } },
    { id: 'extra-close-hole', label: '   Luk af hul', format: 'currency', value: extras.lukAfHul, subtle: true, info: { type: 'qtyPrice', qty: antalLukHuller, unitPrice: LUK_HULLER_RATE } },
    { id: 'extra-concrete', label: '   Boring i beton', format: 'currency', value: extras.boring, subtle: true, info: { type: 'qtyPrice', qty: antalBoringBeton, unitPrice: BORING_BETON_RATE } },
    { id: 'extra-folding-rail', label: '   Opslåeligt rækværk', format: 'currency', value: extras.opskydeligt, subtle: true, info: { type: 'qtyPrice', qty: antalOpskydeligt, unitPrice: OPSKYDELIGT_RATE } },
    {
      id: 'extra-trolley',
      label: '   Tralleløft',
      format: 'currency',
      value: tralleSum,
      subtle: true,
      info: {
        type: 'trolley',
        qty: (tralleState?.n35 || 0) + (tralleState?.n50 || 0),
        entries: [
          { qty: tralleState?.n35 || 0, unitPrice: TRAELLE_RATE35 },
          { qty: tralleState?.n50 || 0, unitPrice: TRAELLE_RATE50 }
        ]
      }
    },
    { id: 'accordSum', label: '3. Samlet akkordsum', format: 'currency', value: totals.samletAkkordsum, emphasize: true },
    { id: 'hours', label: '4. Timer', format: 'hours', value: totalHours },
    { id: 'team', label: '5. Medarbejdere & timer', format: 'team', value: { workersCount: workerCountDisplay, hours: totalHours } }
  ];

  const reviewRowsHtml = reviewRows.map(row => {
    const classes = ['review-row'];
    if (row.subtle) classes.push('review-row--subtle');
    if (row.emphasize) classes.push('review-row--emphasize');
    return `<div class="${classes.join(' ')}"><span>${row.label}</span><strong>${formatReviewValue(row)}</strong></div>`;
  }).join('');

  const formulaNoteSource = (exportMeta.slaebFormulaText || '').trim();
  const formulaNoteHtml = formulaNoteSource
    ? `<p class="a9-formula-note"><strong>A9 slæb-formel:</strong> ${escapeHtml(exportMeta.slaebFormulaText).replace(/\n/g, '<br>')}</p>`
    : '';

  wrapper.innerHTML = `
    <style>
      .export-preview { font-family: system-ui, -apple-system, Segoe UI, sans-serif; }
      .export-preview h2 { margin-top: 0; }
      .export-preview section { margin-bottom: 16px; }
      .export-preview h3 { margin: 0 0 8px; }
      .export-preview .review-grid { display: flex; flex-direction: column; gap: 6px; }
      .export-preview .review-row { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; }
      .export-preview .review-row--subtle { color: #4f4f4f; font-size: 13px; }
      .export-preview .review-row--emphasize { font-weight: 600; }
      .export-preview .review-row span { flex: 1; }
      .export-preview .review-row strong { white-space: pre-wrap; text-align: right; }
      .export-preview .a9-formula-note { margin-top: 10px; font-size: 13px; color: #1f2937; }
      .export-preview .a9-formula-note strong { margin-right: 6px; }
      .export-preview .totals { display: flex; gap: 12px; flex-wrap: wrap; }
      .export-preview .totals div { background: #f7f7f7; border: 1px solid #ddd; padding: 8px 12px; border-radius: 6px; }
    </style>
    <h2>Akkordseddel</h2>
    <section>
      <h3>Oversigt</h3>
      <div class="review-grid">
        ${reviewRowsHtml}
      </div>
      ${formulaNoteHtml}
    </section>
    <section>
      <h3>Løn & projektsum</h3>
      <div class="totals">
        <div><strong>Lønsum</strong><div>${formatCurrency(laborSum)} kr</div></div>
        <div><strong>Projektsum</strong><div>${formatCurrency(projectSum)} kr</div></div>
      </div>
    </section>
  `;

  document.body.appendChild(wrapper);
  try {
    const { jsPDF, html2canvas } = await ensureExportLibsLazy();
    const canvas = await html2canvas(wrapper, { scale: 2, backgroundColor: '#ffffff' });
    const doc = new jsPDF({ unit: 'px', format: [canvas.width, canvas.height] });
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
    const baseName = sanitizeFilename(options.baseName || info.sagsnummer || 'akkordseddel');
    const blob = doc.output('blob');
    return { blob, baseName, fileName: `${baseName}.pdf` };
  } catch (err) {
    console.error('PDF eksport fejlede:', err);
    updateActionHint('PDF eksport fejlede. Prøv igen.', 'error');
    return null;
  } finally {
    document.body.removeChild(wrapper);
  }
}


async function exportPDF(customSagsnummer, options = {}) {
  const payload = await exportPDFBlob(customSagsnummer, options);
  if (!payload) return;
  const url = URL.createObjectURL(payload.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = payload.fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  updateActionHint('PDF er gemt til din enhed.', 'success');
}

function exportAkkordJsonFile() {
  const payload = buildAkkordJsonPayload();
  if (!payload) return;
  const blob = new Blob([payload.content], { type: 'application/json' });
  triggerBlobDownload(blob, payload.fileName);
  updateActionHint('Akkordseddel (JSON) er gemt.', 'success');
}

// --- Samlet eksport ---
// --- CSV-import for optælling ---
function importJSONProject(file) {
  const reader = new FileReader();
  reader.onload = async event => {
    try {
      const text = event.target?.result;
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Ugyldigt JSON format');
      }
      const snapshot = parsed.data && !parsed.sagsinfo ? parsed.data : parsed;
      const normalized = normalizeImportedJsonSnapshot(snapshot);
      await applyProjectSnapshot(normalized, { skipHint: true });
      updateActionHint('JSON sag er indlæst.', 'success');
    } catch (error) {
      console.error('Kunne ikke importere JSON', error);
      updateActionHint('Kunne ikke importere JSON-filen.', 'error');
    }
  };
  reader.onerror = () => {
    updateActionHint('Kunne ikke læse filen.', 'error');
  };
  reader.readAsText(file, 'utf-8');
}

function uploadCSV(file) {
  if (!file) return;
  if (!/\.csv$/i.test(file.name) && !(file.type && file.type.includes('csv'))) {
    updateActionHint('Vælg en gyldig CSV-fil for at importere.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = event => {
    try {
      const rows = parseCSV(event.target.result);
      applyCSVRows(rows);
      updateActionHint('CSV er importeret.', 'success');
    } catch (err) {
      console.error('Kunne ikke importere CSV', err);
      updateActionHint('Kunne ikke importere CSV-filen.', 'error');
    }
  };
  reader.readAsText(file, 'utf-8');
}

function setupMobileKeyboardDismissal() {
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const type = target.type?.toLowerCase?.() || '';
    const mode = target.inputMode?.toLowerCase?.() || '';
    if (type === 'number' || mode === 'numeric' || mode === 'decimal') {
      event.preventDefault();
      target.blur();
    }
  });

  document.addEventListener('change', event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const type = target.type?.toLowerCase?.() || '';
    const mode = target.inputMode?.toLowerCase?.() || '';
    if (type === 'number' || mode === 'numeric' || mode === 'decimal') {
      if (typeof target.blur === 'function') {
        target.blur();
      }
    }
  });
}

function setupServiceWorkerMessaging() {
  if (!('serviceWorker' in navigator)) return;
  if (navigator.webdriver) return;
  let hasReloaded = false;
  const RELOAD_KEY = 'cssmate_sw_reloaded';

  const markReloaded = () => {
    if (hasReloaded) return true;
    try {
      if (window.sessionStorage?.getItem(RELOAD_KEY) === '1') {
        hasReloaded = true;
        return true;
      }
      window.sessionStorage?.setItem(RELOAD_KEY, '1');
    } catch (error) {
      // ignore
    }
    hasReloaded = true;
    return false;
  };

  const triggerReload = () => {
    if (markReloaded()) return;
    console.info('Ny version registreret – genindlæser appen.');
    window.location.reload();
  };

  navigator.serviceWorker.addEventListener('message', event => {
    const messageType = event.data?.type;
    if (messageType === 'CSMATE_UPDATED' || messageType === 'SSCaff_NEW_VERSION') {
      triggerReload();
    }
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    triggerReload();
  });
}

function setupPWAInstallPrompt() {
  if (typeof window === 'undefined') return;

  const installButton = document.getElementById('installBtn');
  const iosBanner = document.getElementById('iosInstallPrompt');
  const iosDismissButton = document.getElementById('iosInstallDismiss');
  if (!installButton && !iosBanner) return;

  const displayModeMedia = typeof window.matchMedia === 'function'
    ? window.matchMedia('(display-mode: standalone)')
    : null;
  const isStandalone = () => (displayModeMedia?.matches ?? false) || navigator.standalone === true;
  let serviceWorkerReady = false;

  const hideInstallButton = () => {
    if (installButton) {
      installButton.setAttribute('hidden', '');
      installButton.disabled = false;
      installButton.removeAttribute('title');
    }
  };

  const showInstallButton = () => {
    if (installButton) {
      installButton.removeAttribute('hidden');
      installButton.disabled = false;
      installButton.removeAttribute('title');
    }
  };

  const updateInstallButtonState = () => {
    if (!installButton) return;

    if (!serviceWorkerReady || isStandalone()) {
      hideInstallButton();
      return;
    }

    showInstallButton();
    if (getDeferredInstallPromptEvent()) {
      installButton.disabled = false;
      installButton.removeAttribute('title');
    } else {
      installButton.disabled = true;
      installButton.title = INSTALL_BUTTON_DISABLED_TOOLTIP;
    }
  };

  const hasDismissedIOSPrompt = () => {
    try {
      return window.localStorage?.getItem(IOS_INSTALL_PROMPT_DISMISSED_KEY) === '1';
    } catch (error) {
      console.warn('Kunne ikke læse iOS prompt flag', error);
      return false;
    }
  };

  const hideIOSHint = (persist = false) => {
    if (iosBanner) {
      iosBanner.setAttribute('hidden', '');
    }
    if (persist) {
      try {
        window.localStorage?.setItem(IOS_INSTALL_PROMPT_DISMISSED_KEY, '1');
      } catch (error) {
        console.warn('Kunne ikke gemme iOS prompt flag', error);
      }
    }
  };

  const maybeShowIOSHint = () => {
    if (!iosBanner) return;
    const ua = navigator.userAgent || '';
    const isiOS = /iphone|ipad|ipod/i.test(ua);
    const isSafari = /safari/i.test(ua) && !/(crios|fxios|edgios)/i.test(ua);
    const isStandalone = (displayModeMedia?.matches ?? false) || navigator.standalone === true;
    if (isiOS && isSafari && !isStandalone && !hasDismissedIOSPrompt()) {
      iosBanner.removeAttribute('hidden');
    } else {
      iosBanner.setAttribute('hidden', '');
    }
  };

  const ensureServiceWorkerReady = () => {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker?.ready) {
      serviceWorkerReady = true;
      updateInstallButtonState();
      return;
    }

    navigator.serviceWorker.ready
      .then(() => {
        serviceWorkerReady = true;
        updateInstallButtonState();
        if (isStandalone()) {
          hideIOSHint(true);
        }
      })
      .catch(error => {
        serviceWorkerReady = true;
        updateInstallButtonState();
        console.warn('Service worker blev ikke klar i tide til install-knappen', error);
      });
  };

  ensureServiceWorkerReady();

  window.addEventListener(PWA_INSTALL_AVAILABLE_EVENT, () => {
    updateInstallButtonState();
  });

  window.addEventListener(PWA_INSTALL_CONSUMED_EVENT, () => {
    updateInstallButtonState();
  });

  installButton?.addEventListener('click', async () => {
    const promptEvent = consumeDeferredInstallPromptEvent();
    if (!promptEvent) return;
    installButton.disabled = true;
    promptEvent.prompt();
    try {
      await promptEvent.userChoice;
    } catch (error) {
      console.warn('Install prompt failed', error);
    } finally {
      hideInstallButton();
    }
  });

  window.addEventListener('appinstalled', () => {
    hideInstallButton();
    hideIOSHint(true);
  });

  if (displayModeMedia?.addEventListener) {
    displayModeMedia.addEventListener('change', event => {
      if (event.matches) {
        hideInstallButton();
        hideIOSHint(true);
      } else {
        updateInstallButtonState();
        maybeShowIOSHint();
      }
    });
  }

  iosDismissButton?.addEventListener('click', () => {
    hideIOSHint(true);
  });

  iosBanner?.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      hideIOSHint(true);
    }
  });

  maybeShowIOSHint();
  updateInstallButtonState();

  if (iosBanner) {
    iosBanner.addEventListener('click', event => {
      if (event.target === iosBanner) {
        hideIOSHint(true);
      }
    });
  }
}

async function hardResetApp() {
  await resetAppState({ reload: true });
}

function setupOfflineCacheReset() {
  const button = document.getElementById('btnResetOfflineCache');
  if (!button) return;
  button.addEventListener('click', async () => {
    const shouldClearDb = typeof window !== 'undefined'
      ? window.confirm('Slet også lokalt lagrede data (IndexedDB)?\nDette fjerner offline-data og kræver ny login.')
      : false;
    button.disabled = true;
    try {
      await resetOfflineCache({ reload: true, clearIndexedDb: shouldClearDb });
    } finally {
      button.disabled = false;
    }
  });
}


// --- Initialization ---
let appInitialized = false;
let bootstrapStarted = false;
let bootstrapConfigured = false;

function showAuthGateShell () {
  if (typeof document === 'undefined') return
  const gate = document.getElementById('authGate')
  if (!gate) return
  if (!gate.hasAttribute('hidden')) return
  gate.removeAttribute('hidden')
  gate.setAttribute('data-locked', 'true')
  document.documentElement.classList.add('auth-locked')
}

function getAuthGateElements () {
  if (typeof document === 'undefined') return {}
  return {
    gate: document.getElementById('authGate'),
    loadingScreen: document.getElementById('authLoadingScreen'),
    loginScreen: document.getElementById('authLoginScreen'),
    message: document.getElementById('authMessage'),
    loginButton: document.getElementById('authLogin'),
    signupButton: document.getElementById('authSignup'),
  }
}

function setAuthGateSection (elements, section) {
  if (!elements?.gate) return
  elements.loadingScreen?.setAttribute('hidden', '')
  elements.loginScreen?.setAttribute('hidden', '')
  if (section === 'loading') elements.loadingScreen?.removeAttribute('hidden')
  if (section === 'login') elements.loginScreen?.removeAttribute('hidden')
}

function setAuthGateMessage (elements, text, variant = '') {
  if (!elements?.message) return
  elements.message.textContent = text || ''
  elements.message.dataset.variant = variant || ''
}

function setAppLocked (locked) {
  if (typeof document === 'undefined') return
  const app = document.getElementById('app')
  document.documentElement.classList.toggle('auth-locked', locked)
  if (!app) return
  if (locked) {
    app.setAttribute('aria-hidden', 'true')
    app.setAttribute('inert', '')
  } else {
    app.removeAttribute('aria-hidden')
    app.removeAttribute('inert')
  }
}

function showLoginOverlay (elements) {
  if (!elements?.gate) return
  elements.gate.removeAttribute('hidden')
  elements.gate.setAttribute('data-locked', 'true')
  document.body?.classList?.add('auth-overlay-open')
  setAppLocked(true)
}

function hideLoginOverlay (elements) {
  if (!elements?.gate) return
  elements.gate.setAttribute('hidden', '')
  elements.gate.removeAttribute('data-locked')
  document.body?.classList?.remove('auth-overlay-open')
  setAuthGateMessage(elements, '')
  setAppLocked(false)
}

async function ensureAuthGateAccess () {
  const elements = getAuthGateElements()
  if (!elements.gate) return { allowed: true, user: null }
  if (shouldSkipAuthGate()) {
    hideLoginOverlay(elements)
    ensureTabsBound()
    return { allowed: true, user: null, skipped: true }
  }

  showLoginOverlay(elements)
  setAuthGateSection(elements, 'loading')
  setAuthGateMessage(elements, '')

  try {
    await getAuth0Client()
    const authed = await isAuthenticated()
    if (!authed) {
      setAuthGateSection(elements, 'login')
      if (elements.loginButton) {
        elements.loginButton.onclick = () => login().catch(() => {})
      }
      if (elements.signupButton) {
        elements.signupButton.onclick = () => signup().catch(() => {})
      }
      return { allowed: false, user: null }
    }

    const user = await getUser()
    hideLoginOverlay(elements)
    ensureTabsBound()
    return { allowed: true, user }
  } catch (error) {
    const message = error?.message || 'Auth0 kunne ikke initialiseres.'
    setAuthGateSection(elements, 'login')
    setAuthGateMessage(elements, message, 'error')
    if (elements.loginButton) {
      elements.loginButton.onclick = () => login().catch(() => {})
    }
    if (elements.signupButton) {
      elements.signupButton.onclick = () => signup().catch(() => {})
    }
    return { allowed: false, user: null, error }
  }
}

function markAppReady () {
  if (typeof document === 'undefined') return
  document.documentElement.classList.remove('app-booting')
  document.documentElement.classList.add('app-ready')
}

async function initApp() {
  if (appInitialized) return;
  appInitialized = true;

  const a9Overlay = document.getElementById('a9-overlay');
  if (a9Overlay) {
    a9Overlay.classList.add('a9-hidden');
    a9Overlay.setAttribute('hidden', '');
    a9Overlay.setAttribute('inert', '');
    a9Overlay.setAttribute('aria-hidden', 'true');
  }

  setupTabPanelsStability();
  initTabs();
  setupUiScaleControls();
  setupAdminLoginButton();
  runWhenIdle(() => initAuth0Ui());
  runWhenIdle(() => maybeShowInviteNotice());

  const optaellingContainer = getDomElement('optaellingContainer');
  if (optaellingContainer) {
    optaellingContainer.addEventListener('input', handleOptaellingInput);
    optaellingContainer.addEventListener('change', handleOptaellingInput);
  }

  runWhenIdle(() => {
    setupAdminControls();
    ensureTeamAdminPageLazy().catch(() => {});
  });

  runWhenIdle(() => ensureSharedCasesPanelLazy().catch(() => {}));

  document.getElementById('btnBeregnLon')?.addEventListener('click', () => beregnLon());

  document.getElementById('btnAddWorker')?.addEventListener('click', () => addWorker());

  const historySelect = getDomElement('jobHistorySelect');
  const loadHistoryButton = getDomElement('btnLoadHistoryJob');
  if (historySelect) {
    historySelect.addEventListener('change', event => {
      updateHistorySummaryFromSelect();
      const hasValue = Boolean(event?.target?.value);
      if (loadHistoryButton) {
        loadHistoryButton.disabled = !hasValue;
      }
    });
  }
  loadHistoryButton?.addEventListener('click', () => handleLoadCase());

  ['traelleloeft35', 'traelleloeft50'].forEach(id => {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener('input', () => updateTotals());
      input.addEventListener('change', () => updateTotals(true));
    }
  });

  ['antalBoringHuller', 'antalLukHuller', 'antalBoringBeton', 'antalOpskydeligt', 'km', 'slaebePct'].forEach(id => {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener('input', () => updateTotals());
      input.addEventListener('change', () => updateTotals(true));
    }
  });

  const jobTypeSelect = document.getElementById('jobType');
  if (jobTypeSelect) {
    jobTypeSelect.addEventListener('change', handleJobTypeChange);
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('cssmate:history:updated', () => {
      populateRecentCases();
    });
  }

  sagsinfoFieldIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => { validateSagsinfo(); scheduleDraftSave(); });
      el.addEventListener('change', () => { validateSagsinfo(); scheduleDraftSave(); });
    }
  });

  const commentField = document.getElementById('akkordComment');
  if (commentField) {
    const persistComment = () => scheduleDraftSave();
    commentField.addEventListener('input', persistComment);
    commentField.addEventListener('change', persistComment);
  }

  validateSagsinfo();
  runWhenIdle(() => {
    setupNumpad();
    setupMobileKeyboardDismissal();
    setupLazyExportPanelTriggers();
    setupOfflineCacheReset();
  });
  if (!IS_AUTOMATED) {
    runWhenIdle(() => {
      setupServiceWorkerMessaging();
      setupPWAInstallPrompt();
    });
  }
  runWhenIdle(() => setupZipExportHistoryHook());

  document.getElementById('btnHardResetApp')?.addEventListener('click', () => {
    hardResetApp();
  });

  document.getElementById('btnNewCase')?.addEventListener('click', async () => {
    const ok = window.confirm('Nulstil sag? Dette sletter den aktuelle kladde på enheden.');
    if (!ok) return;
    await resetCurrentJob();
  });

  const calendarIcon = document.getElementById('calendarIcon');
  if (calendarIcon) {
    calendarIcon.addEventListener('click', () => {
      const dateField = document.getElementById('sagsdato');
      if (!dateField) return;
      if (typeof dateField.showPicker === 'function') {
        dateField.showPicker();
      } else {
        dateField.focus();
        if (typeof dateField.click === 'function') {
          dateField.click();
        }
      }
    });
  }
}

async function restoreDraftOnLoad() {
  try {
    const draft = loadDraft();
    if (!draft) return;
    await applyProjectSnapshot(draft, { skipHint: true });
    lastDraftSerialized = JSON.stringify(draft);
    updateActionHint('Kladde gendannet.', 'success');
  } catch (error) {
    console.warn('Kunne ikke gendanne kladde', error);
    clearDraft();
  }
}

function scheduleAuthBootstrap () {
  if (IS_AUTOMATED || IS_CI || IS_LIGHTHOUSE) return
  runWhenIdle(() => {
    ensureAuthBootstrapModule()
      .then(mod => mod?.initAuth?.())
      .catch(error => {
        console.warn('Auth bootstrap fejlede', error)
      })
  })
}

function configureBootstrap () {
  if (bootstrapConfigured) return
  bootstrapConfigured = true
  IS_CI = isCi()
  IS_LIGHTHOUSE = isLighthouse()
  IS_AUTOMATED = isAutomated()
  applyBuildMetadata()
  if (!IS_AUTOMATED) {
    setupServiceWorkerAutoReload()
  }
  setupVersionCheck()
  if (!IS_AUTOMATED) {
    setupInstallPromptListeners()
  }
  exposeDebugHooks()
  exposeExportHelpers()
  initBootInline()
  initTabDiagnosticsLazy()
  if (isDiagnosticsEnabled()) {
    mountDiagnostics({ forceVisible: true, allowSwReset: true })
  }
  runWhenIdle(() => {
    loadDefaultAdminCode().catch(() => {})
  })
  admin = restoreAdminState()
  if (typeof document !== 'undefined') {
    initClickGuard()
  }
}

export async function bootstrapApp () {
  if (bootstrapStarted) return
  bootstrapStarted = true
  configureBootstrap()
  initDebugOverlayLazy()
  initTabs()

  forceLoginOnce().catch(() => {})
  const authGateState = await ensureAuthGateAccess()
  if (!authGateState.allowed) {
    markAppReady()
    return
  }

  scheduleAuthBootstrap()

  let authGatePromise = null
  authGatePromise = initAuthGateLazy().catch(error => {
    console.warn('Kunne ikke indlæse auth-gate', error)
    return null
  })
  initAppGuardLazy()
  try {
    if (!IS_CI) {
      await authGatePromise
      await initApp()
      await restoreDraftOnLoad()
    }
  } catch (error) {
    console.error('CSMate init fejlede', error)
    const message = error?.message || 'Kunne ikke initialisere appen. Opdater siden for at prøve igen.'
    updateActionHint(message, 'error')
  } finally {
    markAppReady()
  }

  if (authGatePromise) {
    authGatePromise
      .then(authGate => authGate?.prefetchAuth?.())
      .catch(() => {})
  }
  runWhenIdle(() => {
    warmupAuthProvider().catch(() => {})
  })
}
