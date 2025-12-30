import { getAdminEmails, isAdminEmail, normalizeEmail } from '../src/auth/roles.js';
import {
  getFirebaseConfigSummary,
  getFirebaseEnvKeyMap,
  readWindowFirebaseConfig,
  sanitizeFirebaseConfig,
  validateFirebaseConfig,
} from '../src/config/firebase-utils.js';

const DEFAULT_PROVIDER = 'custom';
const DEFAULT_ENABLED_PROVIDERS = ['google', 'microsoft'];
export const FIREBASE_SDK_VERSION = '10.12.2';
const MOCK_AUTH_STORAGE_KEY = 'cssmate:mockAuthUser';
const FIREBASE_CONFIG_CACHE_KEY = 'cssmate:firebaseConfig';
const FIREBASE_CONFIG_ENDPOINT = '/.netlify/functions/firebase-config';
const DEFAULT_APP_CHECK_ENABLED = true;
const AUTH_INIT_TIMEOUT_MS = 15000;
const AUTH_ACTION_TIMEOUT_MS = 15000;

let authInstance = null;
let authModule = null;
let initPromise = null;
let authReady = false;
let authError = null;
let currentUser = null;
let rawUser = null;
let providerData = [];
let useMockAuth = false;
let mockUser = null;
const listeners = new Set();
let appCheckInitPromise = null;
let appCheckStarted = false;
let appCheckModule = null;
let firebaseAppInstance = null;
let initSequence = 0;
export let APP_CHECK_STATUS = 'off';
export let APP_CHECK_REASON = '';
let firebaseConfigSnapshot = null;
let firebaseConfigStatus = { isValid: false, missingKeys: [], placeholderKeys: [] };
let lastAuthErrorCode = '';
let configWarningLogged = false;
let firebaseConfigPromise = null;

function setAppCheckState(status, reason = '') {
  APP_CHECK_STATUS = status;
  APP_CHECK_REASON = reason || '';
}

function readEnvValue(name) {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && typeof import.meta.env[name] !== 'undefined') {
      return import.meta.env[name];
    }
  } catch {}
  if (typeof window !== 'undefined' && typeof window[name] !== 'undefined') {
    return window[name];
  }
  return undefined;
}

function resolveBooleanFlag(value, defaultValue = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.trim().toLowerCase() === 'true';
  }
  return defaultValue;
}

function resolveAppCheckEnabledFlag() {
  const envValue = readEnvValue('VITE_APP_CHECK_ENABLED');
  const windowValue = typeof window !== 'undefined' ? window.FIREBASE_APP_CHECK_ENABLED : undefined;
  const rawValue = typeof envValue !== 'undefined' ? envValue : windowValue;
  return resolveBooleanFlag(rawValue, DEFAULT_APP_CHECK_ENABLED);
}

function isLocalhost() {
  if (typeof window === 'undefined') return false;
  const host = (window.location?.hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

function isWebDriver () {
  if (typeof navigator === 'undefined') return false;
  return navigator.webdriver === true;
}

function isE2eTestMode() {
  const envValue = readEnvValue('VITE_E2E_TEST_MODE');
  const windowValue = typeof window !== 'undefined' ? window.CSSMATE_E2E_TEST_MODE : undefined;
  const rawValue = typeof envValue !== 'undefined' ? envValue : windowValue;
  if (!resolveBooleanFlag(rawValue, false)) return false;
  return isLocalhost() || isWebDriver() || isDevBuild();
}

function loadMockUser() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage?.getItem(MOCK_AUTH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn('Kunne ikke læse mock login', error);
    return null;
  }
}

function persistMockUser(user) {
  if (typeof window === 'undefined') return;
  if (!user) {
    try {
      window.localStorage?.removeItem(MOCK_AUTH_STORAGE_KEY);
    } catch (error) {
      console.warn('Kunne ikke rydde mock login', error);
    }
    return;
  }
  try {
    window.localStorage?.setItem(MOCK_AUTH_STORAGE_KEY, JSON.stringify(user));
  } catch (error) {
    console.warn('Kunne ikke gemme mock login', error);
  }
}

function ensureMockUserVerified() {
  if (!mockUser) return;
  mockUser.emailVerified = true;
  setAuthState({ user: mockUser, error: null });
  persistMockUser(mockUser);
}

function getFirebaseConfig() {
  const windowConfig = readWindowFirebaseConfig();
  if (windowConfig) return sanitizeFirebaseConfig(windowConfig);
  return readCachedFirebaseConfig();
}

function readCachedFirebaseConfig() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage?.getItem(FIREBASE_CONFIG_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return sanitizeFirebaseConfig(parsed);
  } catch (error) {
    console.warn('Kunne ikke læse Firebase config cache', error);
    return null;
  }
}

function cacheFirebaseConfig(config) {
  if (typeof window === 'undefined' || !config) return;
  try {
    window.sessionStorage?.setItem(FIREBASE_CONFIG_CACHE_KEY, JSON.stringify(config));
  } catch (error) {
    console.warn('Kunne ikke gemme Firebase config cache', error);
  }
}

async function fetchFirebaseConfig() {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutId = setTimeout(() => controller?.abort(), 8000);
  let response;
  try {
    response = await fetch(FIREBASE_CONFIG_ENDPOINT, {
      headers: { Accept: 'application/json' },
      signal: controller?.signal,
    });
  } catch (error) {
    error.code = error?.name === 'AbortError' ? 'config-timeout' : 'config-fetch';
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response?.ok) {
    const error = new Error(`Firebase config endpoint fejlede (${response?.status || 'ukendt status'}).`);
    error.code = 'config-response';
    throw error;
  }
  const data = await response.json();
  return sanitizeFirebaseConfig(data);
}

function buildOfflineConfigError() {
  const error = new Error('Du er offline. Kan ikke hente login-konfiguration.');
  error.code = 'offline-config';
  return error;
}

async function loadFirebaseConfig() {
  if (firebaseConfigPromise) return firebaseConfigPromise;
  firebaseConfigPromise = (async () => {
    const cached = getFirebaseConfig();
    try {
      const fetched = await fetchFirebaseConfig();
      if (fetched) {
        cacheFirebaseConfig(fetched);
        if (typeof window !== 'undefined') {
          window.FIREBASE_CONFIG = fetched;
        }
        return fetched;
      }
    } catch (error) {
      if (cached) return cached;
      if (error?.code === 'config-fetch' || error?.code === 'config-timeout') {
        throw buildOfflineConfigError();
      }
      throw error;
    }
    if (cached) return cached;
    throw buildOfflineConfigError();
  })();
  try {
    return await firebaseConfigPromise;
  } catch (error) {
    firebaseConfigPromise = null;
    throw error;
  }
}

async function loadFirebaseSdk() {
  if (authModule) return authModule;
  const [{ initializeApp, getApp, getApps }, auth] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth.js`),
  ]);
  authModule = { initializeApp, getApp, getApps, ...auth };
  return authModule;
}

async function loadAppCheckSdk() {
  if (appCheckModule) return appCheckModule;
  appCheckModule = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app-check.js`);
  return appCheckModule;
}

function getAppCheckSiteKey() {
  const candidates = [
    readEnvValue('VITE_FIREBASE_RECAPTCHA_V3_SITE_KEY'),
    readEnvValue('VITE_FIREBASE_APP_CHECK_SITE_KEY'),
    typeof window !== 'undefined' ? window.FIREBASE_RECAPTCHA_V3_SITE_KEY : null,
    typeof window !== 'undefined' ? window.FIREBASE_APP_CHECK_SITE_KEY : null,
  ].filter(Boolean);
  const siteKey = candidates.find(value => typeof value === 'string' && value.trim());
  if (siteKey) return siteKey.trim();
  return '';
}

function isDevBuild() {
  return Boolean((typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) || isLocalhost());
}

async function ensureAppCheck(app) {
  if (!app) {
    setAppCheckState('off', 'no_app');
    return Promise.resolve(null);
  }
  if (isWebDriver()) {
    setAppCheckState('off', 'webdriver');
    appCheckInitPromise = Promise.resolve(null);
    return appCheckInitPromise;
  }
  if (appCheckStarted && appCheckInitPromise) return appCheckInitPromise;
  if (appCheckInitPromise) return appCheckInitPromise;

  const enabled = resolveAppCheckEnabledFlag();
  const siteKey = getAppCheckSiteKey();
  if (!enabled) {
    setAppCheckState('off', 'disabled');
    appCheckInitPromise = Promise.resolve(null);
    return appCheckInitPromise;
  }
  if (!siteKey) {
    console.warn('App Check deaktiveret: mangler reCAPTCHA v3 site key.');
    setAppCheckState('off', 'missing_site_key');
    appCheckInitPromise = Promise.resolve(null);
    return appCheckInitPromise;
  }

  appCheckInitPromise = (async () => {
    try {
      const sdk = await loadAppCheckSdk();
      if (isDevBuild() && typeof self !== 'undefined') {
        try {
          self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
        } catch (error) {
          console.warn('Kunne ikke aktivere App Check debug token', error);
        }
      }
      sdk.initializeAppCheck(app, {
        provider: new sdk.ReCaptchaV3Provider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
      appCheckStarted = true;
      setAppCheckState('on', '');
    } catch (error) {
      console.warn('App Check init fejlede', error);
      setAppCheckState('failed', error?.message || 'init_failed');
    }
    return null;
  })();
  return appCheckInitPromise;
}

function scheduleAppCheckInit(app) {
  if (appCheckStarted || appCheckInitPromise) return;
  const kickoff = () => ensureAppCheck(app).catch(() => {});
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(kickoff, { timeout: 2000 });
  } else {
    setTimeout(kickoff, 300);
  }
}

export async function getFirebaseAppInstance() {
  let config = await loadFirebaseConfig();
  const validation = validateFirebaseConfig(config);
  firebaseConfigStatus = validation;
  firebaseConfigSnapshot = config;
  if (!validation.isValid) {
    const error = buildConfigError(validation);
    logConfigDiagnostics(validation);
    throw error;
  }
  const sdk = await loadFirebaseSdk();
  if (!firebaseAppInstance) {
    firebaseAppInstance = sdk.getApps?.().length ? sdk.getApp() : sdk.initializeApp(config);
  }
  scheduleAppCheckInit(firebaseAppInstance);
  return firebaseAppInstance;
}

function notify() {
  const context = getAuthContext();
  listeners.forEach(listener => {
    try {
      listener(context);
    } catch (error) {
      console.warn('Auth listener fejlede', error);
    }
  });
}

function setAuthState({ user, error }) {
  rawUser = user || null;
  currentUser = user ? normalizeUser(user) : null;
  providerData = (user && user.providerData) ? user.providerData : (currentUser?.providerData || []);
  authError = error || null;
  lastAuthErrorCode = error?.code || lastAuthErrorCode || '';
  authReady = true;
  notify();
}

function withTimeout(promise, timeoutMs, context) {
  if (!timeoutMs) return promise;
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error('Login timeout. Prøv igen.');
      err.code = 'timeout';
      err.context = context;
      reject(err);
    }, timeoutMs);
    timeoutId?.unref?.();
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function logDevDiagnostics(label, payload) {
  if (!isDevBuild()) return;
  try {
    console.info(`[Auth] ${label}`, payload);
  } catch {}
}

function logConfigDiagnostics(validation) {
  if (configWarningLogged) return;
  if (validation?.isValid) return;
  configWarningLogged = true;
  const missing = validation?.missingKeys || [];
  const placeholders = validation?.placeholderKeys || [];
  const hostname = typeof window !== 'undefined' ? window.location?.hostname || '' : '';
  console.warn('Firebase konfiguration mangler eller er placeholder.', {
    missingKeys: missing,
    placeholderKeys: placeholders,
    hostname,
  });
}

function buildConfigError(validation) {
  const missing = [...(validation?.missingKeys || []), ...(validation?.placeholderKeys || [])].filter(Boolean);
  const error = new Error(
    'Firebase config mangler. Bed admin om at sætte Netlify miljøvariabler. Se konsollen for detaljer.'
  );
  error.code = 'missing-config';
  error.missingKeys = missing;
  return error;
}

function reportFirebaseConfigStatus(config) {
  const validation = validateFirebaseConfig(config);
  firebaseConfigStatus = validation;
  firebaseConfigSnapshot = config;
  if (!validation.isValid) {
    logDevDiagnostics('config-missing', {
      missingKeys: validation.missingKeys,
      placeholderKeys: validation.placeholderKeys,
    });
    logConfigDiagnostics(validation);
  }
  return validation;
}

function logAuthEvent(action, detail = {}) {
  if (!isDevBuild()) return;
  const safeDetail = { ...detail };
  if (safeDetail.error && typeof safeDetail.error === 'object') {
    safeDetail.error = { code: safeDetail.error.code || '', message: safeDetail.error.message || '' };
  }
  logDevDiagnostics(action, safeDetail);
}

export async function initSharedAuth() {
  if (initPromise) return initPromise;
  const initId = ++initSequence;
  const setAuthStateIfCurrent = (payload) => {
    if (initId !== initSequence) return;
    setAuthState(payload);
  };
  const authInitTimer = setTimeout(() => {
    if (authReady || initId !== initSequence) return;
    const timeoutError = new Error('Login tager for lang tid. Prøv igen.');
    timeoutError.code = 'auth-timeout';
    setAuthStateIfCurrent({ user: null, error: timeoutError });
    initPromise = null;
  }, 15000);
  initPromise = (async () => {
    const authInitTimer = setTimeout(() => {
      if (!authReady) {
        const timeoutError = new Error('Login tager for lang tid. Prøv igen.');
        timeoutError.code = 'auth-timeout';
        setAuthState({ user: null, error: timeoutError });
      }
    }, AUTH_INIT_TIMEOUT_MS);
    authInitTimer?.unref?.();
    let config = null;
    let offlineConfigError = null;
    try {
      config = await loadFirebaseConfig();
    } catch (error) {
      const cached = getFirebaseConfig();
      const fallback = cached || null;
      offlineConfigError = error?.code === 'offline-config' ? error : null;
      config = fallback;
    }
    const validation = reportFirebaseConfigStatus(config);
    const envKeyMap = getFirebaseEnvKeyMap();
    const envPresence = Object.fromEntries(
      Object.entries(envKeyMap).map(([configKey, envKey]) => [envKey, Boolean(config?.[configKey])])
    );
    logDevDiagnostics('env-presence', envPresence);
    logAuthEvent('auth-strategy', { preferred: shouldPreferRedirect() ? 'redirect' : 'popup' });
    if (!validation.isValid) {
      if (isLocalhost() || isE2eTestMode()) {
        useMockAuth = true;
        mockUser = loadMockUser();
        if (!mockUser && isE2eTestMode()) {
          mockUser = {
            uid: `mock-e2e-${Date.now()}`,
            email: 'e2e@example.com',
            displayName: 'E2E Testbruger',
            providerId: DEFAULT_PROVIDER,
            providerIds: [DEFAULT_PROVIDER],
            emailVerified: true,
          };
          persistMockUser(mockUser);
        }
        setAuthState({ user: mockUser, error: null });
        clearTimeout(authInitTimer);
        return null;
      }
      const error = offlineConfigError || buildConfigError(validation);
      setAuthState({ user: null, error });
      clearTimeout(authInitTimer);
      return null;
    }
    try {
      warnIfUnauthorizedHost(config);
      logAuthEvent('config-ok', getFirebaseConfigSummary(config));
      const app = await withTimeout(getFirebaseAppInstance(), AUTH_INIT_TIMEOUT_MS, 'firebase-init');
      const sdk = await loadFirebaseSdk();
      authInstance = sdk.getAuth(app);
      try {
        await sdk.setPersistence(authInstance, sdk.browserLocalPersistence);
      } catch (error) {
        console.warn('Kunne ikke sætte persistence', error);
      }
      sdk.onAuthStateChanged(authInstance, (user) => setAuthStateIfCurrent({ user, error: null }));
      try {
        await withTimeout(sdk.getRedirectResult(authInstance), AUTH_ACTION_TIMEOUT_MS, 'redirect-result');
      } catch (error) {
        logAuthError('redirectResult', error);
      }
      setAuthState({ user: authInstance.currentUser, error: null });
      logAuthEvent('init-success', { hasUser: Boolean(authInstance.currentUser) });
      return authInstance;
    } catch (error) {
      logAuthError('init', error);
      setAuthState({ user: null, error });
      return null;
    } finally {
      clearTimeout(authInitTimer);
    }
  })();
  return initPromise;
}

export function onAuthStateChange(callback) {
  if (typeof callback !== 'function') return () => {};
  listeners.add(callback);
  if (authReady) callback(getAuthContext());
  return () => listeners.delete(callback);
}

export async function waitForAuthReady() {
  await initSharedAuth();
  if (authReady) return getAuthContext();
  return new Promise(resolve => {
    const unsubscribe = onAuthStateChange((context) => {
      if (context.isReady) {
        resolve(context);
        unsubscribe();
      }
    });
  });
}

function getProvider(providerId) {
  if (!authModule || !authInstance) throw new Error('Auth ikke klar');
  logAuthEvent('provider-init', { providerId });
  switch (providerId) {
    case 'google':
      return new authModule.GoogleAuthProvider();
    case 'microsoft':
      return new authModule.OAuthProvider('microsoft.com');
    case 'apple':
      return new authModule.OAuthProvider('apple.com');
    case 'facebook':
      return new authModule.FacebookAuthProvider();
    default:
      throw new Error('Ukendt login-udbyder');
  }
}

export function getEnabledProviders() {
  if (typeof window !== 'undefined') {
    const providers = window.FIREBASE_AUTH_PROVIDERS;
    if (Array.isArray(providers)) return providers;
    if (typeof providers === 'string' && providers.trim()) {
      return providers.split(',').map(entry => entry.trim()).filter(Boolean);
    }
  }
  return DEFAULT_ENABLED_PROVIDERS;
}

function collectProviderIds(user) {
  if (!user) return [];
  if (Array.isArray(user.providerIds)) return user.providerIds.filter(Boolean);
  if (Array.isArray(user.providerData)) {
    return user.providerData.map(entry => entry?.providerId).filter(Boolean);
  }
  const id = user.providerId || user.provider;
  return id ? [id] : [];
}

function isUserVerified(user) {
  if (!user) return false;
  const providers = collectProviderIds(user);
  const hasPassword = providers.includes('password');
  const hasFederated = providers.some(id => id && id !== 'password');
  if (hasPassword) return Boolean(user.emailVerified);
  if (hasFederated) return true;
  return Boolean(user.emailVerified);
}

function shouldFallbackToRedirect(error) {
  if (!error) return false;
  const code = error?.code || '';
  return code.includes('popup') || code === 'auth/cancelled-popup-request' || code === 'auth/popup-closed-by-user';
}

function shouldPreferRedirect() {
  if (typeof window === 'undefined') return false;
  const coarsePointer = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const isMobileAgent = /android|iphone|ipad|ipod/i.test(userAgent);
  return coarsePointer || isMobileAgent;
}

function buildAuthHint(error) {
  const code = error?.code || '';
  if (code.includes('popup')) {
    return 'Popup blev blokeret. Prøv igen eller brug redirect-login.';
  }
  if (code === 'auth/unauthorized-domain') {
    return 'Domænet er ikke godkendt i Firebase Auth.';
  }
  if (code === 'auth/internal-error') {
    return 'Der opstod en intern login-fejl. Prøv igen.';
  }
  return 'Tjek netværk og prøv igen.';
}

function logAuthError(context, error) {
  if (!error) return;
  lastAuthErrorCode = error?.code || lastAuthErrorCode || '';
  console.warn('Auth fejl', {
    context,
    code: error?.code || '',
    message: error?.message || '',
    origin: typeof window !== 'undefined' ? window.location?.origin : '',
  });
}

function normalizeHost(host) {
  if (!host || typeof host !== 'string') return '';
  return host.replace(/^https?:\/\//, '').trim();
}

function warnIfUnauthorizedHost(config) {
  if (typeof window === 'undefined') return;
  const authDomain = normalizeHost(config?.authDomain);
  const currentHost = normalizeHost(window.location?.host || '');
  const extra = readEnvValue('VITE_FIREBASE_AUTH_ALLOWED_HOSTS') || (typeof window !== 'undefined' ? window.FIREBASE_AUTH_ALLOWED_HOSTS : '');
  const allowlist = new Set([authDomain, currentHost].filter(Boolean));
  if (typeof extra === 'string' && extra.trim()) {
    extra.split(',').map(entry => normalizeHost(entry)).filter(Boolean).forEach(entry => allowlist.add(entry));
  }
  if (currentHost && authDomain && !allowlist.has(currentHost)) {
    console.warn('Firebase Auth domæne mismatch', { authDomain, currentHost, allowlist: Array.from(allowlist) });
  }
}

export async function loginWithProvider(providerId) {
  await initSharedAuth();
  if (!firebaseConfigStatus.isValid) {
    const error = buildConfigError(firebaseConfigStatus);
    setAuthState({ user: null, error });
    throw error;
  }
  if (useMockAuth) {
    const mock = {
      uid: `mock-${providerId || 'user'}`,
      email: providerId === 'google' ? 'mock.google.user@example.com' : `${providerId || 'user'}@example.com`,
      displayName: providerId === 'google' ? 'Mock Google Bruger' : 'Mock bruger',
      providerId: providerId ? `${providerId}.com` : DEFAULT_PROVIDER,
      emailVerified: true,
      providerIds: [providerId ? `${providerId}.com` : DEFAULT_PROVIDER],
    };
    mockUser = mock;
    persistMockUser(mockUser);
    setAuthState({ user: mockUser, error: null });
    return mockUser;
  }
  if (!authModule || !authInstance) throw new Error('Login er ikke konfigureret.');
  const provider = getProvider(providerId);
  provider.setCustomParameters?.({ prompt: 'select_account' });
  try {
    if (shouldPreferRedirect()) {
      logAuthEvent('login-redirect', { providerId });
      await authModule.signInWithRedirect(authInstance, provider);
      return;
    }
    logAuthEvent('login-popup', { providerId });
    await withTimeout(authModule.signInWithPopup(authInstance, provider), AUTH_ACTION_TIMEOUT_MS, 'login-popup');
  } catch (error) {
    logAuthError('loginWithProvider', error);
    if (shouldFallbackToRedirect(error)) {
      logAuthEvent('login-fallback-redirect', { providerId, code: error?.code || '' });
      await authModule.signInWithRedirect(authInstance, provider);
      return;
    }
    setAuthState({ user: null, error });
    const loginError = new Error(buildAuthHint(error));
    loginError.code = error?.code;
    loginError.original = error;
    throw loginError;
  }
}

export async function logoutUser() {
  await initSharedAuth();
  if (useMockAuth) {
    mockUser = null;
    persistMockUser(null);
    setAuthState({ user: null, error: null });
    return;
  }
  if (!authModule || !authInstance) return;
  try {
    await withTimeout(authModule.signOut(authInstance), AUTH_ACTION_TIMEOUT_MS, 'logout');
    setAuthState({ user: null, error: null });
  } catch (error) {
    console.warn('Logout fejlede', error);
    throw error;
  }
}

export function getAuthContext() {
  if (!authReady) {
    return { isReady: false, isAuthenticated: false, user: null, providers: [], message: 'Login initialiseres…', error: authError };
  }
  if (authError) {
    return { isReady: true, isAuthenticated: false, user: null, providers: [], message: authError.message || 'Login-fejl', error: authError };
  }
  if (!currentUser) {
    return { isReady: true, isAuthenticated: false, user: null, providers: [], message: 'Log ind for at se delte sager.', error: null };
  }
  const isVerified = isUserVerified(currentUser);
  const requiresVerification = !isVerified;
  return {
    isReady: true,
    isAuthenticated: true,
    user: currentUser,
    providers: Array.isArray(providerData) ? providerData : [],
    isVerified,
    requiresVerification,
    message: requiresVerification ? 'Bekræft din email for adgang.' : '',
    error: null,
  };
}

export function getCurrentUser() {
  return currentUser || null;
}

export async function signUpWithEmail(email, password) {
  await initSharedAuth();
  const cleanEmail = (email || '').trim();
  if (!cleanEmail || !password) throw new Error('Udfyld email og adgangskode');
  if (useMockAuth) {
    mockUser = {
      uid: `mock-${Date.now()}`,
      email: cleanEmail.toLowerCase(),
      displayName: cleanEmail,
      providerId: 'password',
      providerIds: ['password'],
      emailVerified: false,
    };
    persistMockUser(mockUser);
    setAuthState({ user: mockUser, error: null });
    return mockUser;
  }
  if (!authModule || !authInstance) throw new Error('Login er ikke konfigureret.');
  const credential = await withTimeout(
    authModule.createUserWithEmailAndPassword(authInstance, cleanEmail, password),
    AUTH_ACTION_TIMEOUT_MS,
    'signup-email'
  );
  if (credential?.user) {
    await withTimeout(authModule.sendEmailVerification(credential.user), AUTH_ACTION_TIMEOUT_MS, 'verify-email');
    setAuthState({ user: credential.user, error: null });
  }
  return credential?.user || null;
}

export async function signInWithEmail(email, password) {
  await initSharedAuth();
  const cleanEmail = (email || '').trim();
  if (!cleanEmail || !password) throw new Error('Udfyld email og adgangskode');
  if (useMockAuth) {
    if (!mockUser || mockUser.email !== cleanEmail.toLowerCase()) {
      throw new Error('Brugeren findes ikke. Opret en konto først.');
    }
    setAuthState({ user: mockUser, error: null });
    return mockUser;
  }
  if (!authModule || !authInstance) throw new Error('Login er ikke konfigureret.');
  const credential = await withTimeout(
    authModule.signInWithEmailAndPassword(authInstance, cleanEmail, password),
    AUTH_ACTION_TIMEOUT_MS,
    'login-email'
  );
  setAuthState({ user: credential?.user, error: null });
  return credential?.user || null;
}

export async function sendPasswordReset(email) {
  await initSharedAuth();
  const cleanEmail = (email || '').trim();
  if (!cleanEmail) throw new Error('Angiv email-adresse');
  if (useMockAuth) {
    return true;
  }
  if (!authModule || !authInstance) throw new Error('Login er ikke konfigureret.');
  await withTimeout(authModule.sendPasswordResetEmail(authInstance, cleanEmail), AUTH_ACTION_TIMEOUT_MS, 'reset-password');
  return true;
}

export async function resendEmailVerification() {
  await initSharedAuth();
  if (useMockAuth) {
    if (!mockUser) throw new Error('Ingen bruger er logget ind.');
    return true;
  }
  if (!authModule || !authInstance) throw new Error('Login er ikke konfigureret.');
  if (!authInstance.currentUser) throw new Error('Ingen bruger er logget ind.');
  await withTimeout(authModule.sendEmailVerification(authInstance.currentUser), AUTH_ACTION_TIMEOUT_MS, 'verify-resend');
  return true;
}

export async function reloadCurrentUser() {
  await initSharedAuth();
  if (useMockAuth) {
    ensureMockUserVerified();
    return mockUser;
  }
  if (!authModule || !authInstance) throw new Error('Login er ikke konfigureret.');
  if (!authInstance.currentUser) throw new Error('Ingen bruger er logget ind.');
  await withTimeout(authModule.reload(authInstance.currentUser), AUTH_ACTION_TIMEOUT_MS, 'reload-user');
  setAuthState({ user: authInstance.currentUser, error: null });
  return authInstance.currentUser;
}

export function isMockAuthEnabled() {
  return useMockAuth || false;
}

export function getAuthDiagnostics() {
  const configSummary = getFirebaseConfigSummary(firebaseConfigSnapshot || {});
  return {
    authReady,
    isAuthenticated: Boolean(currentUser),
    user: currentUser,
    projectId: configSummary.projectId,
    authDomain: configSummary.authDomain,
    appCheckStatus: APP_CHECK_STATUS,
    appCheckReason: APP_CHECK_REASON,
    lastAuthErrorCode: lastAuthErrorCode || authError?.code || '',
    configStatus: { ...firebaseConfigStatus },
  };
}

export function getFirebaseConfigStatus() {
  return { ...firebaseConfigStatus };
}

export function getFirebaseConfigSnapshot() {
  return firebaseConfigSnapshot ? { ...firebaseConfigSnapshot } : null;
}

export function userIsAdmin(user) {
  if (!user) return false;
  if (user.role === 'admin' || user.claims?.role === 'admin') return true;
  return isAdminEmail(user.email);
}

export function getUserDisplay(user) {
  if (!user) return 'Ukendt bruger';
  if (user.displayName && user.email) return `${user.displayName} (${user.email})`;
  if (user.displayName) return user.displayName;
  if (user.email) return user.email;
  if (user.uid) return user.uid;
  return 'Ukendt bruger';
}

function normalizeUser(user) {
  const primaryProvider = Array.isArray(user?.providerData) && user.providerData.length ? user.providerData[0] : null;
  const providerIds = collectProviderIds(user);
  return {
    uid: user.uid || user.id || user.email || 'user',
    email: user.email || '',
    emailNormalized: normalizeEmail(user.email),
    displayName: user.displayName || user.name || '',
    providerId: user.providerId || user.provider || primaryProvider?.providerId || DEFAULT_PROVIDER,
    role: user.role || user.claims?.role || null,
    emailVerified: Boolean(user.emailVerified),
    providerIds,
    providerData: user.providerData || [],
  };
}

export function getUserProviderName(user) {
  if (!user) return '';
  const providers = collectProviderIds(user);
  const providerId = providers[0] || user.providerId || user.provider || '';
  if (providerId.includes('google')) return 'Google';
  if (providerId.includes('microsoft')) return 'Microsoft';
  if (providerId.includes('apple')) return 'Apple';
  if (providerId.includes('facebook')) return 'Facebook';
  if (providerId.includes('password')) return 'Email / password';
  return providerId || 'Login';
}

export function getAdminWhitelist () {
  return getAdminEmails();
}
