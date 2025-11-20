import { initMaterialsScrollLock } from './src/modules/materialsscrolllock.js'
import { calculateTotals } from './src/modules/calculatetotals.js'
import { normalizeKey } from './src/lib/string-utils.js'
import { EXCLUDED_MATERIAL_KEYS, shouldExcludeMaterialEntry } from './src/lib/materials/exclusions.js'
import { createMaterialRow } from './src/modules/materialrowtemplate.js'
import { sha256Hex, constantTimeEquals } from './src/lib/sha256.js'
import { ensureExportLibs, ensureZipLib, prefetchExportLibs } from './src/features/export/lazy-libs.js'
import { setupNumpad } from './js/numpad.js'
import { exportMeta, setSlaebFormulaText } from './js/export-meta.js'
import { createVirtualMaterialsList } from './src/modules/materialsvirtuallist.js'
import { initClickGuard } from './src/ui/guards/clickguard.js'
import { setAdminOk, restoreAdminState, isAdminUnlocked } from './src/state/admin.js'
import { exportAkkordExcelForActiveJob } from './src/export/akkord-excel.js'
import { setActiveJob } from './src/state/jobs.js'
import './boot-inline.js'

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

(function setupVersionCheck () {
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
})()

const IOS_INSTALL_PROMPT_DISMISSED_KEY = 'csmate.iosInstallPromptDismissed'
const TAB_STORAGE_KEY = 'csmate:lastTab'
const LEGACY_TAB_STORAGE_KEYS = ['sscaff:lastTab', 'cssmate:lastActiveTab']
const KNOWN_TAB_ID_ORDER = ['sagsinfo', 'optaelling', 'lon', 'historik', 'hjaelp']
const KNOWN_TAB_IDS = new Set(KNOWN_TAB_ID_ORDER)
const DEFAULT_TAB_ID = KNOWN_TAB_ID_ORDER[0]
const INSTALL_BUTTON_DISABLED_TOOLTIP = 'Tilføj via browsermenu på denne platform'
const PWA_INSTALL_AVAILABLE_EVENT = 'csmate:pwa-install-available'
const PWA_INSTALL_CONSUMED_EVENT = 'csmate:pwa-install-consumed'
let DEFAULT_ADMIN_CODE_HASH = ''
let materialsVirtualListController = null
let currentTabId = null
let tabButtons = []
let tabPanels = []
const domCache = new Map()
let deferredInstallPromptEvent = null

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

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault()
    setDeferredInstallPromptEvent(event)
  })

  window.addEventListener('appinstalled', () => {
    setDeferredInstallPromptEvent(null)
  })
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

loadDefaultAdminCode()

let admin = restoreAdminState()

// Initialize click guard for admin lock functionality
if (typeof document !== 'undefined') {
  initClickGuard()
}

// --- Utility Functions ---
function updateSlaebFormulaInfo(text) {
  const infoEl = document.getElementById('slaebPercentCalcInfo');
  if (!infoEl) return;
  const value = typeof text === 'string' ? text.trim() : '';
  infoEl.textContent = value ? `Formel (A9): ${value}` : '';
}

let guideModalLastFocus = null;
let guideModalEscapeHandler = null;

function getGuideModalElement() {
  return document.getElementById('guideModal');
}

function attachGuideModalEscapeHandler() {
  if (guideModalEscapeHandler || typeof document === 'undefined') return;
  guideModalEscapeHandler = event => {
    if (event.key === 'Escape' && isGuideModalOpen()) {
      event.preventDefault();
      closeGuideModal();
    }
  };
  document.addEventListener('keydown', guideModalEscapeHandler);
}

function detachGuideModalEscapeHandler() {
  if (!guideModalEscapeHandler || typeof document === 'undefined') return;
  document.removeEventListener('keydown', guideModalEscapeHandler);
  guideModalEscapeHandler = null;
}

// Åbn hjælpeguiden og flyt fokus til dialogen
function openGuideModal() {
  const modal = getGuideModalElement();
  if (!modal) return;
  guideModalLastFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  modal.removeAttribute('hidden');
  modal.dataset.open = 'true';
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  const content = modal.querySelector('.modal-content');
  if (content && typeof content.focus === 'function') {
    content.focus();
  }
  attachGuideModalEscapeHandler();
}

// Luk hjælpeguiden og returnér fokus til tidligere element
function closeGuideModal() {
  const modal = getGuideModalElement();
  if (!modal) return;
  modal.classList.remove('open');
  modal.removeAttribute('data-open');
  modal.setAttribute('aria-hidden', 'true');
  modal.setAttribute('hidden', '');
  detachGuideModalEscapeHandler();
  const previous = guideModalLastFocus;
  guideModalLastFocus = null;
  if (previous && document.contains(previous) && typeof previous.focus === 'function') {
    previous.focus();
  }
}

function isGuideModalOpen() {
  const modal = getGuideModalElement();
  return Boolean(modal && modal.dataset.open === 'true');
}

function setupGuideModal() {
  const modal = getGuideModalElement();
  if (!modal) return;

  const closeBtn = modal.querySelector('.modal-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeGuideModal());
  }

  modal.addEventListener('click', event => {
    if (event.target === modal) {
      closeGuideModal();
    }
  });

  document.getElementById('btnOpenGuideModal')?.addEventListener('click', () => {
    openGuideModal();
  });
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

function refreshTabCollections() {
  if (typeof document === 'undefined') {
    tabButtons = []
    tabPanels = []
    return
  }
  tabButtons = Array.from(document.querySelectorAll('[role="tab"][data-tab-id]'))
    .filter(button => isKnownTabId(button.dataset.tabId))
  tabPanels = Array.from(document.querySelectorAll('[role="tabpanel"][data-tab-panel]'))
    .filter(panel => isKnownTabId(panel.dataset.tabPanel))
}

function ensureTabCollections() {
  if (!tabButtons.length || !tabPanels.length) {
    refreshTabCollections()
  }
  return tabButtons.length && tabPanels.length
}

function findFirstAvailableTabId() {
  const preferred = KNOWN_TAB_ID_ORDER.find(id => tabButtons.some(button => button.dataset.tabId === id))
  if (preferred) {
    return preferred
  }
  return tabButtons[0]?.dataset.tabId || DEFAULT_TAB_ID
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

  if (focus && typeof nextButton.focus === 'function') {
    nextButton.focus();
  }
}

// Initier faner og tastaturnavigation
function initTabs() {
  refreshTabCollections()

  if (!tabButtons.length || !tabPanels.length) {
    console.warn('Faner kunne ikke initialiseres – mangler markup');
    return;
  }

  tabButtons.forEach((button, index) => {
    const tabId = button.dataset.tabId;
    const isSelected = button.getAttribute('aria-selected') === 'true';
    button.tabIndex = isSelected ? 0 : -1;
    button.addEventListener('click', () => setActiveTab(tabId));
    button.addEventListener('keydown', event => handleTabKeydown(event, index));
  });

  const storedTabId = getStoredTabId();
  const initialTabId = tabButtons.some(button => button.dataset.tabId === storedTabId)
    ? storedTabId
    : (tabButtons.find(button => button.getAttribute('aria-selected') === 'true')?.dataset.tabId || findFirstAvailableTabId());

  setActiveTab(initialTabId, { focus: false });

  if (typeof window !== 'undefined') {
    window.__cssmateSetActiveTab = (tabId, options) => setActiveTab(tabId, options);
  }
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
let lastEkompletData = null;
let lastJobSummary = null;
let recentCasesCache = [];

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
const AKKORD_EXCEL_SYSTEMS = [
  { id: 'bosta', label: 'BOSTA 2025' },
  { id: 'haki', label: 'HAKI 2025' },
  { id: 'modex', label: 'MODEX 2025' },
  { id: 'alfix', label: 'ALFIX 2025' },
];
const AKKORD_EXCEL_STORAGE_KEY = 'csmate.akkordExcelSystem';
let systemDatasets = {};
let dataBosta = [];
let dataHaki = [];
let dataModex = [];
let dataAlfix = [];
let systemOptions = [];
let systemLabelMap = new Map();
const selectedSystemKeys = new Set();
let excelSystemSelectionCache = new Set(['bosta']);
let datasetModulePromise = null;
let materialsReady = false;
let showOnlySelectedMaterials = false;
let lastRenderShowSelected = null;
let lonOutputsRevealed = false;

function loadMaterialDatasetModule () {
  if (!datasetModulePromise) {
    datasetModulePromise = import('./dataset.js');
  }
  return datasetModulePromise;
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

function isSupportedExcelSystem(value) {
  if (!value) return false;
  return AKKORD_EXCEL_SYSTEMS.some(option => option.id === value);
}

function normalizeExcelSystemId(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function sanitizeExcelSystemSelection(values) {
  const list = Array.isArray(values)
    ? values
    : (typeof values === 'string'
      ? [values]
      : (values && typeof values[Symbol.iterator] === 'function'
        ? Array.from(values)
        : []));
  const unique = [];
  list.forEach(value => {
    const normalized = normalizeExcelSystemId(value);
    if (isSupportedExcelSystem(normalized) && !unique.includes(normalized)) {
      unique.push(normalized);
    }
  });
  return unique;
}

function getStoredExcelSystems() {
  if (typeof localStorage === 'undefined') {
    return Array.from(excelSystemSelectionCache);
  }
  try {
    const raw = localStorage.getItem(AKKORD_EXCEL_STORAGE_KEY);
    if (raw === null) {
      return Array.from(excelSystemSelectionCache);
    }
    let parsed = [];
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw ? [raw] : [];
    }
    const sanitized = sanitizeExcelSystemSelection(parsed);
    excelSystemSelectionCache = new Set(sanitized);
    return sanitized;
  } catch (error) {
    console.warn('Kunne ikke læse Excel-systemer fra storage', error);
    return Array.from(excelSystemSelectionCache);
  }
}

function setStoredExcelSystems(values) {
  const sanitized = sanitizeExcelSystemSelection(values);
  excelSystemSelectionCache = new Set(sanitized);
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(AKKORD_EXCEL_STORAGE_KEY, JSON.stringify(sanitized));
  } catch (error) {
    console.warn('Kunne ikke gemme Excel-systemer', error);
  }
}

function getPreferredExcelSystem() {
  const stored = getStoredExcelSystems();
  if (stored.length > 0 && isSupportedExcelSystem(stored[0])) return stored[0];
  const selected = getSelectedSystemKeys();
  const match = selected.find(key => isSupportedExcelSystem(key));
  if (match) return match;
  return AKKORD_EXCEL_SYSTEMS[0]?.id || 'bosta';
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

  if (!showOnlySelectedMaterials) {
    return combined;
  }

  return combined.filter(item => toNumber(item?.quantity) > 0);
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
      return `
        <label class="system-option">
          <input type="checkbox" value="${option.key}" ${checked}>
          <span>${option.label}</span>
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

  if (lastRenderShowSelected !== showOnlySelectedMaterials && materialsVirtualListController) {
    materialsVirtualListController.controller.destroy?.();
    materialsVirtualListController = null;
  }
  lastRenderShowSelected = showOnlySelectedMaterials;

  if (!materialsVirtualListController || materialsVirtualListController.container !== list) {
    const controller = createVirtualMaterialsList({
      container: list,
      items,
      renderRow,
      rowHeight: 64,
      overscan: 8
    })
    materialsVirtualListController = { container: list, controller }
  } else {
    materialsVirtualListController.controller.update(items)
  }

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

function setSagsinfoField(id, value) {
  const el = getDomElement(id);
  if (!el) return;
  el.value = value;
}

function updateActionHint(message = '', variant = 'info') {
  const hint = getDomElement('actionHint');
  if (!hint) return;
  hint.classList.remove('error', 'success');
  if (!message) {
    hint.textContent = DEFAULT_ACTION_HINT;
    hint.style.display = 'none';
    return;
  }
  hint.textContent = message;
  if (variant === 'error') {
    hint.classList.add('error');
  } else if (variant === 'success') {
    hint.classList.add('success');
  }
  hint.style.display = '';
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

async function saveProject(data) {
  if (!data) return;
  try {
    const db = await openDB();
    if (!db) return;
    const tx = db.transaction(DB_STORE, 'readwrite');
    const completion = new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error('Transaktionen blev afbrudt'));
      tx.onerror = () => reject(tx.error || new Error('Transaktionen fejlede'));
    });
    const store = tx.objectStore(DB_STORE);
    await promisifyRequest(store.add({ data, ts: Date.now() }));
    const all = await promisifyRequest(store.getAll());
    if (Array.isArray(all) && all.length > 20) {
      all.sort((a, b) => (a.ts || 0) - (b.ts || 0));
      const excess = all.length - 20;
      for (let index = 0; index < excess; index += 1) {
        const item = all[index];
        if (item && item.id != null) {
          await promisifyRequest(store.delete(item.id));
        }
      }
    }
    await completion;
  } catch (error) {
    console.warn('Kunne ikke gemme sag lokalt', error);
  }
}

async function deleteProjectById(id) {
  if (!Number.isFinite(id) || id <= 0) return false;
  try {
    const db = await openDB();
    if (!db) return false;
    const tx = db.transaction(DB_STORE, 'readwrite');
    const completion = new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onabort = () => reject(tx.error || new Error('Transaktionen blev afbrudt'));
      tx.onerror = () => reject(tx.error || new Error('Transaktionen fejlede'));
    });
    const store = tx.objectStore(DB_STORE);
    store.delete(Number(id));
    await completion;
    return true;
  } catch (error) {
    console.warn('Kunne ikke slette sag', error);
    return false;
  }
}

async function getRecentProjects() {
  try {
    const db = await openDB();
    if (!db) return [];
    const tx = db.transaction(DB_STORE, 'readonly');
    const completion = new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error('Transaktionen blev afbrudt'));
      tx.onerror = () => reject(tx.error || new Error('Transaktionen fejlede'));
    });
    const store = tx.objectStore(DB_STORE);
    const items = await promisifyRequest(store.getAll());
    await completion;
    if (!Array.isArray(items)) return [];
    return items
      .filter(entry => entry && entry.data)
      .sort((a, b) => (b.ts || 0) - (a.ts || 0));
  } catch (error) {
    console.warn('Kunne ikke hente lokale sager', error);
    return [];
  }
}

function setHistoryListBusy(isBusy) {
  const list = getDomElement('historyList');
  if (!list) return;
  list.setAttribute('aria-busy', isBusy ? 'true' : 'false');
}

function formatHistoryTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  try {
    return new Intl.DateTimeFormat('da-DK', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  } catch {
    return date.toLocaleString('da-DK');
  }
}

function renderHistoryList(entries = recentCasesCache) {
  const list = getDomElement('historyList');
  if (!list) return;
  list.innerHTML = '';
  const cases = Array.isArray(entries)
    ? entries.filter(entry => entry && entry.data)
    : [];
  if (!cases.length) {
    const empty = document.createElement('li');
    empty.className = 'history-list__empty';
    empty.textContent = 'Ingen historik endnu.';
    list.appendChild(empty);
    setHistoryListBusy(false);
    return;
  }
  cases.slice(0, 10).forEach(entry => {
    const li = document.createElement('li');
    li.className = 'history-list__item';
    const info = entry.data?.sagsinfo || {};
    const titleText = info.navn?.trim()
      || info.sagsnummer?.trim()
      || 'Sag uden navn';
    const title = document.createElement('span');
    title.className = 'history-list__title';
    title.textContent = titleText;
    const meta = document.createElement('span');
    meta.className = 'history-list__meta';
    const parts = [];
    if (info.sagsnummer) parts.push(info.sagsnummer);
    const systems = Array.isArray(entry.data?.systems)
      ? entry.data.systems
        .map(key => systemLabelMap.get(key) || key)
        .filter(Boolean)
      : [];
    if (systems.length) {
      parts.push(systems.join(', '));
    }
    const timestamp = formatHistoryTimestamp(entry.ts || entry.data?.timestamp);
    if (timestamp) {
      parts.push(timestamp);
    }
    const totals = entry.data?.totals;
    if (totals) {
      const material = toNumber(totals.materialSum);
      const labor = toNumber(totals.laborSum);
      const combined = material + labor;
      if (combined > 0) {
        parts.push(`Sum ${formatCurrency(combined)}`);
      }
    }
    meta.textContent = parts.join(' • ');
    li.appendChild(title);
    if (parts.length) {
      li.appendChild(meta);
    }
    const actions = document.createElement('div');
    actions.className = 'history-list__actions';
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'history-list__delete';
    deleteBtn.dataset.id = entry.id;
    deleteBtn.dataset.action = 'delete-history';
    deleteBtn.textContent = 'Slet';
    actions.appendChild(deleteBtn);
    li.appendChild(actions);
    list.appendChild(li);
  });
  setHistoryListBusy(false);
}

function setupHistoryListActions() {
  const list = getDomElement('historyList');
  if (!list || list.dataset.boundDelete === 'true') return;
  list.dataset.boundDelete = 'true';
  list.addEventListener('click', async event => {
    const button = event.target instanceof HTMLElement
      ? event.target.closest('[data-action="delete-history"]')
      : null;
    if (!button) return;
    const id = Number(button.dataset.id);
    if (!(id > 0)) return;
    const ok = window.confirm('Er du sikker på, at du vil slette denne sag?');
    if (!ok) return;
    button.disabled = true;
    const deleted = await deleteProjectById(id);
    if (!deleted) {
      button.disabled = false;
      return;
    }
    recentCasesCache = recentCasesCache.filter(entry => Number(entry?.id) !== id);
    syncRecentProjectsGlobal(recentCasesCache);
    renderHistoryList(recentCasesCache);
    populateRecentCases();
  });
}

function findHistoryEntryById(id) {
  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }
  return recentCasesCache.find(entry => Number(entry?.id) === id) || null;
}

function buildHistorySummary(entry) {
  if (!entry || !entry.data) {
    return null;
  }
  const totals = entry.data.totals || {};
  const timer = toNumber(totals.timer ?? totals.totalHours);
  const baseRate = toNumber(totals.hourlyBase ?? totals.akkordTimeLon ?? totals.timeprisUdenTillaeg);
  const mentorRate = toNumber(totals.mentorRate);
  const appliedMentorRate = mentorRate > 0 ? mentorRate : DEFAULT_MENTOR_RATE;
  let hourlyUdd1 = toNumber(totals.hourlyUdd1);
  let hourlyUdd2 = toNumber(totals.hourlyUdd2);
  let hourlyUdd2Mentor = toNumber(totals.hourlyUdd2Mentor);
  const hasBase = baseRate > 0;
  if (!(hourlyUdd1 > 0) && hasBase) {
    hourlyUdd1 = baseRate + TILLAEG_UDD1;
  }
  if (!(hourlyUdd2 > 0) && hasBase) {
    hourlyUdd2 = baseRate + TILLAEG_UDD2;
  }
  if (!(hourlyUdd2Mentor > 0) && hasBase) {
    hourlyUdd2Mentor = baseRate + TILLAEG_UDD2 + appliedMentorRate;
  }

  return {
    date: formatHistoryTimestamp(entry.ts || entry.data.timestamp),
    timer: timer > 0 ? timer : 0,
    hourlyBase: hasBase ? baseRate : 0,
    hourlyUdd1: hourlyUdd1 > 0 ? hourlyUdd1 : 0,
    hourlyUdd2: hourlyUdd2 > 0 ? hourlyUdd2 : 0,
    hourlyUdd2Mentor: hourlyUdd2Mentor > 0 ? hourlyUdd2Mentor : 0,
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
    summary.timer > 0 ? formatNumber(summary.timer) : '–',
    formatRate(summary.hourlyBase),
    formatRate(summary.hourlyUdd1),
    formatRate(summary.hourlyUdd2),
    formatRate(summary.hourlyUdd2Mentor),
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
  const selectedId = Number(select?.value);
  let entry = null;
  if (Number.isFinite(selectedId) && selectedId > 0) {
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
  setHistoryListBusy(true);
  const cases = await getRecentProjects();
  recentCasesCache = cases;
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

function collectExtrasState() {
  const getValue = id => getDomElement(id)?.value ?? '';
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
    km: getValue('km'),
    traelle35: getValue('traelleloeft35'),
    traelle50: getValue('traelleloeft50'),
  };
}

function collectProjectSnapshot() {
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

  return {
    timestamp: Date.now(),
    sagsinfo: collectSagsinfo(),
    systems: Array.from(selectedSystemKeys),
    materials,
    labor,
    extras: collectExtrasState(),
    totals,
  };
}

async function persistProjectSnapshot() {
  try {
    const snapshot = collectProjectSnapshot();
    await saveProject(snapshot);
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
  assign('km', extras.km);
  assign('traelleloeft35', extras.traelle35);
  assign('traelleloeft50', extras.traelle50);

  computeTraelleTotals();
}

function applyMaterialsSnapshot(materials = [], systems = []) {
  resetMaterials();
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
        }
        return;
      }
      const fallback = manualMaterials.find(man => !man.name && man.quantity === 0 && man.price === 0);
      if (fallback) {
        fallback.name = item?.name || '';
        fallback.price = Number.isFinite(price) ? price : 0;
        fallback.quantity = quantity;
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

function applyProjectSnapshot(snapshot, options = {}) {
  if (!snapshot || typeof snapshot !== 'object') return;
  const info = snapshot.sagsinfo || {};
  setSagsinfoField('sagsnummer', info.sagsnummer || '');
  setSagsinfoField('sagsnavn', info.navn || '');
  setSagsinfoField('sagsadresse', info.adresse || '');
  setSagsinfoField('sagskunde', info.kunde || '');
  setSagsinfoField('sagsdato', info.dato || '');
  setSagsinfoField('sagsmontoer', info.montoer || '');

  applyMaterialsSnapshot(snapshot.materials, snapshot.systems);
  applyExtrasSnapshot(snapshot.extras);
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

async function handleLoadCase() {
  const select = getDomElement('jobHistorySelect');
  if (!select) return;
  const value = Number(select.value);
  if (!Number.isFinite(value) || value <= 0) return;
  let record = recentCasesCache.find(entry => Number(entry.id) === value);
  if (!record) {
    const cases = await getRecentProjects();
    recentCasesCache = cases;
    syncRecentProjectsGlobal(recentCasesCache);
    record = cases.find(entry => Number(entry.id) === value);
    renderHistoryList(recentCasesCache);
  }
  if (record && record.data) {
    applyProjectSnapshot(record.data, { skipHint: false });
    renderJobHistorySummary(record);
  } else {
    updateActionHint('Kunne ikke indlæse den valgte sag.', 'error');
  }
}

function validateSagsinfo() {
  let isValid = true;
  sagsinfoFieldIds.forEach(id => {
    const el = getDomElement(id);
    if (!el) return;
    const rawValue = (el.value || '').trim();
    let fieldValid = rawValue.length > 0;
    if (id === 'sagsdato') {
      fieldValid = rawValue.length > 0 && !Number.isNaN(new Date(rawValue).valueOf());
    }
    if (!fieldValid) {
      isValid = false;
    }
    el.classList.toggle('invalid', !fieldValid);
  });

  ['btnExportZip', 'btnPrint'].forEach(id => {
    const btn = getDomElement(id);
    if (btn) btn.disabled = !isValid;
  });

  if (isValid) {
    updateActionHint('');
  } else {
    updateActionHint(DEFAULT_ACTION_HINT, 'error');
  }

  return isValid;
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

function formatDateForDisplay(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isNaN(date.valueOf())) {
    return date.toLocaleDateString('da-DK');
  }
  return String(value);
}

function getExcelSystemInputs() {
  if (typeof document === 'undefined') return [];
  return Array.from(document.querySelectorAll('input[name="akkordExcelSystem"][type="checkbox"]'));
}

function getExcelSystemSelectionFromInputs() {
  const inputs = getExcelSystemInputs();
  if (inputs.length === 0) {
    return Array.from(excelSystemSelectionCache);
  }
  const selected = inputs.filter(input => input.checked).map(input => input.value);
  return sanitizeExcelSystemSelection(selected);
}

function syncExcelSystemSelector() {
  const inputs = getExcelSystemInputs();
  if (inputs.length === 0) return;
  const selectedKeys = getSelectedSystemKeys();
  const storedSelection = new Set(getStoredExcelSystems());
  inputs.forEach(input => {
    const systemId = normalizeExcelSystemId(input.value);
    input.checked = storedSelection.has(systemId);
    const label = input.closest('.export-system-option');
    const labelText = label?.querySelector('.export-system-option__label');
    const hint = label?.querySelector('.export-system-option__hint');
    const config = AKKORD_EXCEL_SYSTEMS.find(option => option.id === systemId);
    if (labelText && config) {
      labelText.textContent = config.label;
    }
    const isActive = selectedKeys.includes(systemId);
    if (hint) {
      hint.textContent = isActive ? 'Aktiv i sag' : 'Ikke aktiv i sag';
    }
    if (label) {
      label.classList.toggle('export-system-option--inactive', !isActive);
    }
  });
}

function initExcelSystemSelector() {
  syncExcelSystemSelector();
  const container = document.getElementById('akkordExcelSystemOptions');
  if (!container) return;
  container.addEventListener('change', event => {
    const target = event.target;
    if (!target || typeof target.getAttribute !== 'function') return;
    if (target.getAttribute('name') !== 'akkordExcelSystem') return;
    const selected = getExcelSystemSelectionFromInputs();
    setStoredExcelSystems(selected);
  });
}

function requireExcelSystemSelection() {
  const selection = getExcelSystemSelectionFromInputs();
  if (selection.length === 0) {
    const message = 'Vælg mindst ét Excel 25-ark under "Eksport & deling".';
    updateActionHint(message, 'error');
    return null;
  }
  return selection;
}

function triggerBlobDownload(blob, fileName) {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function downloadExcelPayloads(payloads, job) {
  if (!Array.isArray(payloads) || payloads.length === 0) {
    return { count: 0, zipped: false };
  }
  const files = payloads.filter(entry => entry?.blob && entry?.fileName);
  if (files.length === 0) {
    return { count: 0, zipped: false };
  }
  if (files.length === 1) {
    triggerBlobDownload(files[0].blob, files[0].fileName);
    return { count: 1, zipped: false };
  }
  const { JSZip } = await ensureZipLib();
  const zip = new JSZip();
  files.forEach(entry => {
    zip.file(entry.fileName, entry.blob);
  });
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const baseName = sanitizeFilename(job?.sagsinfo?.sagsnummer || job?.caseNo || 'akkordsedler') || 'akkordsedler';
  triggerBlobDownload(zipBlob, `${baseName}_excel.zip`);
  return { count: files.length, zipped: true };
}

function buildExcelExportMessage(result) {
  if (!result || result.count === 0) {
    return '';
  }
  if (result.count === 1) {
    return '1 Excel-ark blev genereret og downloadet direkte. ZIP bruges kun ved flere valg.';
  }
  return `${result.count} Excel-ark blev samlet i én ZIP-fil. ZIP bruges kun ved flere valg.`;
}

async function exportExcelSelection(job, systems) {
  if (!job) return { count: 0, zipped: false };
  const requested = sanitizeExcelSystemSelection(systems);
  if (requested.length === 0) {
    return { count: 0, zipped: false };
  }
  const payloads = await exportAkkordExcelForActiveJob(job, requested);
  return downloadExcelPayloads(payloads, job);
}

function initExportButtons() {
  const primeExports = () => prefetchExportLibs();

  const btnPdf = document.getElementById('btnExportAkkord');
  if (btnPdf) {
    btnPdf.addEventListener('click', () => onExportPdf());
    btnPdf.addEventListener('pointerenter', primeExports, { once: true });
    btnPdf.addEventListener('focus', primeExports, { once: true });
  }

  const btnZip = document.getElementById('btnExportZip');
  if (btnZip) {
    btnZip.addEventListener('click', () => onExportZip());
    btnZip.addEventListener('pointerenter', primeExports, { once: true });
    btnZip.addEventListener('focus', primeExports, { once: true });
  }

  const btnJson = document.getElementById('btnExportJson');
  if (btnJson) {
    btnJson.addEventListener('click', () => exportAkkordJsonFile());
  }

  const importBtn = document.getElementById('btnImportAkkord');
  const importInput = document.getElementById('akkordImportInput');
  if (importBtn && importInput) {
    importBtn.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (file) {
        handleAkkordImport(file);
        importInput.value = '';
      }
    });
  }

  initExcelSystemSelector();
}

async function onExportZip() {
  if (!requireExcelSystemSelection()) return;
  try {
    await exportZip();
    updateActionHint('ZIP eksport gemt.', 'success');
  } catch (error) {
    console.error('ZIP eksport fejlede', error);
    updateActionHint('Kunne ikke eksportere ZIP.', 'error');
  }
}

async function onExportPdf() {
  try {
    await exportPDF();
  } catch (error) {
    console.error('PDF eksport fejlede', error);
    updateActionHint('Kunne ikke eksportere PDF.', 'error');
  }
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
    system: getPreferredExcelSystem(),
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

function applyImportedAkkordData(data) {
  if (!data || typeof data !== 'object') {
    updateActionHint('Kunne ikke læse akkordseddel-data.', 'error');
    return;
  }
  const payload = data.data && !data.materials ? data.data : data;
  const jobType = (payload.type || payload.jobType || 'montage').toLowerCase();
  const extras = payload.extras || {};
  const materialsSource = Array.isArray(payload.materials)
    ? payload.materials
    : Array.isArray(payload.lines)
      ? payload.lines
      : [];

  const materials = materialsSource.map(item => ({
    id: item.id || item.varenr || '',
    name: item.name || item.label || item.title || '',
    price: toNumber(item.unitPrice ?? item.price),
    quantity: toNumber(item.qty ?? item.quantity ?? item.amount),
    system: item.system || item.systemKey || inferSystemFromLine(item),
  })).filter(entry => entry.quantity > 0 || entry.name || entry.id);

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
      const hours = toNumber(entry?.hours);
      const rate = toNumber(entry?.rate ?? entry?.hourlyWithAllowances ?? entry?.hourlyRate);
      const udd = entry?.udd || entry?.education || entry?.educationLevel || '';
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

  const systems = Array.isArray(payload.systems)
    ? payload.systems
    : payload.system
      ? [normalizeExcelSystemId(payload.system)]
      : Array.from(selectedSystemKeys);

  const traelleSum = toNumber(extras.tralleløft ?? extras.tralleloeft ?? extras.tralleløft);
  let traelle35 = extras.traelle35 ?? extras.tralle35 ?? extras.tralleloeft35 ?? extras.tralleløft35;
  let traelle50 = extras.traelle50 ?? extras.tralle50 ?? extras.tralleloeft50 ?? extras.tralleløft50;
  if (!traelle35 && !traelle50 && Number.isFinite(traelleSum) && traelleSum > 0) {
    const derived35 = traelleSum / TRAELLE_RATE35;
    traelle35 = Number.isFinite(derived35) ? derived35.toFixed(2) : '';
  }

  const snapshot = {
    sagsinfo: {
      sagsnummer: payload.jobId || payload.caseNo || payload.id || '',
      navn: payload.jobName || payload.name || payload.title || '',
      adresse: payload.jobAddress || payload.address || payload.site || '',
      kunde: payload.customer || payload.kunde || '',
      dato: payload.createdAt || payload.date || '',
      montoer: payload.montageWorkers || payload.demontageWorkers || payload.worker || payload.montor || '',
    },
    systems,
    materials,
    labor,
    extras: {
      jobType,
      montagepris: extras.montagepris,
      demontagepris: extras.demontagepris,
      slaebePct: extras.slaebePct,
      slaebeFormulaText: extras.slaebeFormulaText,
      antalBoringHuller: extras.huller ?? extras.antalBoringHuller ?? 0,
      antalLukHuller: extras.lukAfHul ?? extras.antalLukHuller ?? 0,
      antalBoringBeton: extras.boringBeton ?? extras.antalBoringBeton ?? 0,
      opskydeligtRaekvaerk: extras.opskydeligt ?? extras.opskydeligtRaekvaerk ?? 0,
      km: extras.km ?? extras.kilometer ?? 0,
      traelle35,
      traelle50,
    },
    totals: payload.totals || {},
  };

  applyProjectSnapshot(snapshot, { skipHint: true });
  updateActionHint('Akkordseddel er importeret. Bekræft arbejdstype og tal.', 'success');
}

async function handleAkkordImport(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    applyImportedAkkordData(parsed);
  } catch (error) {
    console.error('Kunne ikke importere akkordseddel', error);
    updateActionHint('Kunne ikke importere akkordseddel-filen.', 'error');
  }
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

async function login() {
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

const adminLoginButton = document.getElementById('btnAdminLogin');
if (adminLoginButton) {
  adminLoginButton.addEventListener('click', event => {
    event.preventDefault();
    login();
  });
}

// --- Worker Functions ---
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
}

function beregnLon() {
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
  syncExcelSystemSelector();

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
  persistProjectSnapshot();

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

// --- Akkordseddel JSON-eksport ---
/**
 * Akkordseddel JSON-format (v1)
 * {
 *   "version": 1,
 *   "type": "montage" | "demontage",
 *   "jobId": "string",
 *   "jobName": "string",
 *   "createdAt": "ISO-8601 string",
 *   "system": "Bosta" | "Haki" | "Alfix" | "Mixed" | ...,
 *   "systems": ["bosta", "haki", ...],
 *   "materials": [
 *     {
 *       "id": "BOSTA_073X257",
 *       "name": "0,73 x 2,57 dæk",
 *       "qty": 42,
 *       "unitPrice": 12.34,
 *       "lineTotal": 518.28
 *     }
 *   ],
 *   "extras": {
 *     "km": 37,
 *     "tralleløft": 4,
 *     "huller": 3,
 *     "lukAfHul": 2,
 *     "boringBeton": 6,
 *     "opskydeligt": 0,
 *     "slaebePct": 0,
 *     "slaebeBelob": 0
 *   },
 *   "wage": {
 *     "montageHours": 40,
 *     "demontageHours": 0,
 *     "numWorkers": 2,
 *     "hourlyRate": 320.50,
 *     "educationLevel": "",
 *     "totalAkkordSum": 12345.67
 *   }
 * }
 */
function buildAkkordJsonPayload(customSagsnummer, options = {}) {
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

  const materials = getAllData().filter(item => toNumber(item.quantity) > 0);
  const labor = Array.isArray(laborEntries) ? laborEntries : [];
  const tralleState = computeTraelleTotals();
  const tralleSum = tralleState && Number.isFinite(tralleState.sum) ? tralleState.sum : 0;
  const jobType = collectJobType();
  const jobFactor = jobType === 'demontage' ? 0.5 : 1;
  const slaebePctInput = toNumber(document.getElementById('slaebePct')?.value);
  const montageBase = calcMaterialesum() + tralleSum;
  const slaebeBelob = montageBase * (Number.isFinite(slaebePctInput) ? slaebePctInput / 100 : 0);

  const ekstraarbejdeModel = {
    tralleløft: tralleSum,
    traelle35: tralleState?.n35 || 0,
    traelle50: tralleState?.n50 || 0,
    huller: toNumber(document.getElementById('antalBoringHuller')?.value) * BORING_HULLER_RATE,
    lukAfHul: toNumber(document.getElementById('antalLukHuller')?.value) * LUK_HULLER_RATE,
    boringBeton: toNumber(document.getElementById('antalBoringBeton')?.value) * BORING_BETON_RATE,
    opskydeligt: toNumber(document.getElementById('antalOpskydeligt')?.value) * OPSKYDELIGT_RATE,
    km: toNumber(document.getElementById('km')?.value) * KM_RATE,
    slaebePct: slaebePctInput,
    slaebeBelob,
  };

  const laborTotals = labor.map(entry => ({
    hours: toNumber(entry?.hours),
    hourlyWithAllowances: toNumber(entry?.rate),
    udd: entry?.udd || '',
    mentortillaeg: toNumber(entry?.mentortillaeg),
  }));
  const totalHours = laborTotals.reduce((sum, worker) => sum + (Number.isFinite(worker.hours) ? worker.hours : 0), 0);
  const materialLinesForTotals = materials.map(item => ({
    qty: toNumber(item.quantity),
    unitPrice: toNumber(item.price) * jobFactor,
  }));
  const totalsFallback = calculateTotals({
    materialLines: materialLinesForTotals,
    slaebeBelob,
    extra: ekstraarbejdeModel,
    workers: laborTotals,
    totalHours,
  });

  const baseName = sanitizeFilename(info.sagsnummer || 'akkordseddel') || 'akkordseddel';
  const materialsJson = materials.map(item => {
    const qty = toNumber(item.quantity);
    const unitPrice = toNumber(item.price) * jobFactor;
    return {
      id: item.id,
      name: item.name,
      qty,
      unitPrice,
      lineTotal: qty * unitPrice,
      system: inferSystemFromLine(item) || getPreferredExcelSystem(),
    };
  });

  const hourlyBase = toNumber(
    lastJobSummary?.hourlyBase
    ?? totalsFallback.timeprisUdenTillaeg
    ?? totalsFallback.hourlyBase
  );
  const jobPayload = {
    version: 1,
    type: jobType,
    jobId: info.sagsnummer || info.navn || info.adresse || baseName,
    jobName: info.navn || info.adresse || info.sagsnummer || 'Akkordseddel',
    createdAt: new Date().toISOString(),
    system: getPreferredExcelSystem(),
    systems: Array.from(selectedSystemKeys),
    materials: materialsJson,
    extras: ekstraarbejdeModel,
    wage: {
      montageHours: jobType === 'montage' ? totalHours : 0,
      demontageHours: jobType === 'demontage' ? totalHours : 0,
      numWorkers: laborTotals.length || workerCount || 0,
      hourlyRate: hourlyBase,
      educationLevel: laborTotals.find(entry => entry.udd)?.udd || '',
      workers: labor.map(entry => ({
        type: entry?.type || jobType,
        hours: toNumber(entry?.hours),
        rate: toNumber(entry?.rate),
        udd: entry?.udd || '',
        mentortillaeg: toNumber(entry?.mentortillaeg),
      })),
      totalAkkordSum: totalsFallback.samletAkkordsum,
    },
    totals: {
      materialsSum: totalsFallback.materialer,
      extrasSum: totalsFallback.ekstraarbejde,
      haulSum: totalsFallback.slaeb,
      projectSum: totalsFallback.projektsum,
    },
  };

  return {
    content: JSON.stringify(jobPayload, null, 2),
    baseName,
    fileName: `${baseName}.json`,
    data: jobPayload,
  };
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
  const ekstraarbejdeModel = {
    tralleløft: tralleSum,
    huller: toNumber(document.getElementById('antalBoringHuller')?.value) * BORING_HULLER_RATE,
    boring: toNumber(document.getElementById('antalBoringBeton')?.value) * BORING_BETON_RATE,
    lukAfHul: toNumber(document.getElementById('antalLukHuller')?.value) * LUK_HULLER_RATE,
    opskydeligt: toNumber(document.getElementById('antalOpskydeligt')?.value) * OPSKYDELIGT_RATE,
    km: toNumber(document.getElementById('km')?.value) * KM_RATE,
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

  const reviewRows = [
    { id: 'materials', label: '1. Materialer', format: 'currency', value: materialSum },
    { id: 'extraWork', label: '2. Ekstra arbejde', format: 'currency', value: extraSum },
    { id: 'extra-sled', label: '   Slæb', format: 'currency', value: slaebeBelob, subtle: true, info: { type: 'percent', percent: slaebePctInput } },
    { id: 'extra-km', label: '   Kilometer', format: 'currency', value: ekstraarbejdeModel.km, subtle: true, info: { type: 'qtyPrice', qty: antalKm, unitPrice: KM_RATE, unitLabel: 'km' } },
    { id: 'extra-holes', label: '   Boring af huller', format: 'currency', value: ekstraarbejdeModel.huller, subtle: true, info: { type: 'qtyPrice', qty: antalBoringHuller, unitPrice: BORING_HULLER_RATE } },
    { id: 'extra-close-hole', label: '   Luk af hul', format: 'currency', value: ekstraarbejdeModel.lukAfHul, subtle: true, info: { type: 'qtyPrice', qty: antalLukHuller, unitPrice: LUK_HULLER_RATE } },
    { id: 'extra-concrete', label: '   Boring i beton', format: 'currency', value: ekstraarbejdeModel.boring, subtle: true, info: { type: 'qtyPrice', qty: antalBoringBeton, unitPrice: BORING_BETON_RATE } },
    { id: 'extra-folding-rail', label: '   Opslåeligt rækværk', format: 'currency', value: ekstraarbejdeModel.opskydeligt, subtle: true, info: { type: 'qtyPrice', qty: antalOpskydeligt, unitPrice: OPSKYDELIGT_RATE } },
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
    { id: 'accordSum', label: '3. Samlet akkordsum', format: 'currency', value: totalsFallback.samletAkkordsum, emphasize: true },
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
      .export-preview ul { list-style: none; padding: 0; margin: 0; }
      .export-preview ul li { margin-bottom: 6px; }
      .export-preview table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      .export-preview th, .export-preview td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; font-size: 14px; }
      .export-preview th { background: #f0f0f0; }
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
      <h3>Sagsinfo</h3>
      <ul>
        <li><strong>Sagsnummer:</strong> ${escapeHtml(info.sagsnummer)}</li>
        <li><strong>Navn/opgave:</strong> ${escapeHtml(info.navn)}</li>
        <li><strong>Adresse:</strong> ${escapeHtml(info.adresse)}</li>
        <li><strong>Kunde:</strong> ${escapeHtml(info.kunde)}</li>
        <li><strong>Dato:</strong> ${escapeHtml(info.dato)}</li>
        <li><strong>Montørnavne:</strong> ${escapeHtml(info.montoer).replace(/\n/g, '<br>')}</li>
      </ul>
    </section>
    <section>
      <h3>Materialer</h3>
      ${materials.length ? `
        <table class="export-table">
          <thead>
            <tr><th>Id</th><th>Materiale</th><th>Antal</th><th>Pris</th><th>Linjesum</th></tr>
          </thead>
          <tbody>
            ${materials.map(item => {
              const qty = toNumber(item.quantity);
              const price = toNumber(item.price);
              const total = qty * price;
              const manualIndex = manualMaterials.indexOf(item);
              const label = item.manual ? (item.name?.trim() || `Manuelt materiale ${manualIndex + 1}`) : item.name;
              return `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(label)}</td><td>${qty.toLocaleString('da-DK', { maximumFractionDigits: 2 })}</td><td>${formatCurrency(price)} kr</td><td>${formatCurrency(total)} kr</td></tr>`;
            }).join('')}
          </tbody>
        </table>
      ` : '<p>Ingen materialer registreret.</p>'}
    </section>
    <section>
      <h3>Løn</h3>
      ${labor.length ? `
        <table class="export-table">
          <thead>
            <tr><th>Arbejdstype</th><th>Timer</th><th>Sats</th><th>Linjesum</th></tr>
          </thead>
          <tbody>
            ${labor.map((entry, index) => {
              const hours = toNumber(entry.hours);
              const rate = toNumber(entry.rate);
              const total = hours * rate;
              const type = entry.type || `Arbejdstype ${index + 1}`;
              return `<tr><td>${escapeHtml(type)}</td><td>${hours.toLocaleString('da-DK', { maximumFractionDigits: 2 })}</td><td>${formatCurrency(rate)} kr</td><td>${formatCurrency(total)} kr</td></tr>`;
            }).join('')}
          </tbody>
        </table>
      ` : '<p>Ingen lønlinjer registreret.</p>'}
    </section>
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
    <section>
      <h3>Detaljer</h3>
      ${document.getElementById('lonResult')?.innerHTML || '<p>Ingen beregning udført.</p>'}
    </section>
  `;

  document.body.appendChild(wrapper);
  try {
    const { jsPDF, html2canvas } = await ensureExportLibs();
    const canvas = await html2canvas(wrapper, { scale: 2, backgroundColor: '#ffffff' });
    const doc = new jsPDF({ unit: 'px', format: [canvas.width, canvas.height] });
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
    const baseName = sanitizeFilename(info.sagsnummer || 'akkordseddel');
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

async function exportZip() {
  if (!validateSagsinfo()) {
    updateActionHint('Udfyld Sagsinfo for at eksportere.', 'error');
    return;
  }
  try {
    const { JSZip } = await ensureZipLib();
    beregnLon();
    const csvPayload = buildCSVPayload(null, { skipValidation: true, skipBeregn: true });
    if (!csvPayload) return;
    const pdfPayload = await exportPDFBlob(csvPayload.originalName || csvPayload.baseName, { skipValidation: true, skipBeregn: true });
    if (!pdfPayload) return;
    const jsonPayload = buildAkkordJsonPayload(csvPayload.originalName || csvPayload.baseName, { skipValidation: true, skipBeregn: true });

    const zip = new JSZip();
    zip.file(csvPayload.fileName, csvPayload.content);
    zip.file(pdfPayload.fileName, pdfPayload.blob);
    if (jsonPayload) {
      zip.file(jsonPayload.fileName, jsonPayload.content);
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const link = document.createElement('a');
    const baseName = csvPayload.baseName || pdfPayload.baseName || 'akkordseddel';
    link.href = url;
    link.download = `${baseName}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    updateActionHint('ZIP med PDF og CSV er gemt.', 'success');
  } catch (error) {
    console.error('ZIP eksport fejlede', error);
    updateActionHint('ZIP eksport fejlede. Prøv igen.', 'error');
  }
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
  reader.onload = event => {
    try {
      const text = event.target?.result;
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Ugyldigt JSON format');
      }
      const snapshot = parsed.data && !parsed.sagsinfo ? parsed.data : parsed;
      applyProjectSnapshot(snapshot, { skipHint: true });
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
  let hasReloaded = false;

  navigator.serviceWorker.addEventListener('message', event => {
    const messageType = event.data?.type;
    if (messageType === 'CSMATE_UPDATED' || messageType === 'SSCaff_NEW_VERSION') {
      window.location.reload();
    }
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hasReloaded) return;
    hasReloaded = true;
    window.location.reload();
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
  if (navigator.serviceWorker) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(reg => reg.unregister()));
  }

  if (window.caches) {
    const names = await caches.keys();
    await Promise.all(names.map(name => caches.delete(name)));
  }

  if (window.indexedDB) {
    const dbs = await indexedDB.databases?.() || [];
    await Promise.all(dbs.map(db => new Promise(resolve => {
      if (!db?.name) {
        resolve();
        return;
      }
      const request = indexedDB.deleteDatabase(db.name);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    })));
  }

  try {
    window.localStorage?.clear();
  } catch {}
  try {
    window.sessionStorage?.clear();
  } catch {}

  window.location.reload(true);
}


// --- Initialization ---
let appInitialized = false;

async function initApp() {
  if (appInitialized) return;
  appInitialized = true;

  try {
    await ensureMaterialDatasets();
  } catch (error) {
    console.error('Kunne ikke indlæse materialelisterne.', error);
    updateActionHint('Kunne ikke indlæse materialelisterne. Prøv at genindlæse siden.', 'error');
  }

  initTabs();

  const optaellingContainer = getDomElement('optaellingContainer');
  if (optaellingContainer) {
    optaellingContainer.addEventListener('input', handleOptaellingInput);
    optaellingContainer.addEventListener('change', handleOptaellingInput);
  }

  addWorker();

  setupGuideModal();
  setupAdminControls();
  setupA9Integration();

  document.getElementById('btnBeregnLon')?.addEventListener('click', () => beregnLon());
  document.getElementById('btnPrint')?.addEventListener('click', () => {
    if (validateSagsinfo()) {
      window.print();
    } else {
      updateActionHint('Udfyld Sagsinfo for at kunne printe.', 'error');
    }
  });

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

  sagsinfoFieldIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => validateSagsinfo());
      el.addEventListener('change', () => validateSagsinfo());
    }
  });

  validateSagsinfo();
  setupNumpad();
  setupMobileKeyboardDismissal();
  setupServiceWorkerMessaging();
  setupPWAInstallPrompt();

  document.getElementById('btnHardResetApp')?.addEventListener('click', () => {
    hardResetApp();
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

  ensureMaterialDatasets()
    .then(() => {
      setupListSelectors();
      renderOptaelling();
      setupCSVImport();
      populateRecentCases();
      initExportButtons();
      updateTotals(true);
    })
    .catch(error => {
      console.error('Materialelister kunne ikke indlæses', error);
      updateActionHint('Kunne ikke indlæse materialelisterne. Opdater siden for at prøve igen.', 'error');
    });
}

function startApp () {
  initApp().catch(error => {
    console.error('CSMate init fejlede', error);
    updateActionHint('Kunne ikke initialisere appen. Opdater siden for at prøve igen.', 'error');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp, { once: true });
} else {
  startApp();
}
