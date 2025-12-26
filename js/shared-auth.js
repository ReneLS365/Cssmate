import { getAdminEmails, isAdminEmail, normalizeEmail } from '../src/auth/roles.js';

const DEFAULT_PROVIDER = 'custom';
const DEFAULT_ENABLED_PROVIDERS = ['google', 'microsoft'];
export const FIREBASE_SDK_VERSION = '10.12.2';
const MOCK_AUTH_STORAGE_KEY = 'cssmate:mockAuthUser';
const DEFAULT_APP_CHECK_ENABLED = true;

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
export let APP_CHECK_STATUS = 'off';
export let APP_CHECK_REASON = '';
const APP_CHECK_FALLBACK_SITE_KEY = '6LfFeS8sAAAAAH9hsS136zJ6YOQkpRZKniSIIYYI';

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

function resolveAppCheckEnabledFlag() {
  const envValue = readEnvValue('VITE_APP_CHECK_ENABLED');
  const windowValue = typeof window !== 'undefined' ? window.FIREBASE_APP_CHECK_ENABLED : undefined;
  const rawValue = typeof envValue !== 'undefined' ? envValue : windowValue;
  if (typeof rawValue === 'boolean') return rawValue;
  if (typeof rawValue === 'string') {
    return rawValue.trim().toLowerCase() === 'true';
  }
  return DEFAULT_APP_CHECK_ENABLED;
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
  if (typeof window === 'undefined') return null;
  const config = window.FIREBASE_CONFIG;
  if (config && typeof config === 'object' && Object.keys(config).length > 0) {
    return config;
  }
  return null;
}

async function loadFirebaseConfigFromFunction() {
  if (typeof window === 'undefined') return null;
  try {
    const response = await fetch('/.netlify/functions/firebase-config', { cache: 'no-store' });
    if (!response.ok) {
      console.warn('Kunne ikke hente Firebase konfiguration.');
      return null;
    }
    const config = await response.json();
    if (!config || typeof config !== 'object') {
      console.warn('Ugyldigt svar fra Firebase config endpoint.');
      return null;
    }
    window.FIREBASE_CONFIG = config;
    return config;
  } catch (error) {
    console.warn('Kunne ikke hente Firebase konfiguration.', error);
    return null;
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
  console.warn('App Check site key mangler, bruger fallback (reCAPTCHA v3).');
  return APP_CHECK_FALLBACK_SITE_KEY;
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
  let config = getFirebaseConfig();
  if (!config || !config.apiKey) {
    config = await loadFirebaseConfigFromFunction();
  }
  if (!config) throw new Error('Firebase konfiguration mangler (VITE_FIREBASE_*)');
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
  authReady = true;
  notify();
}

export async function initSharedAuth() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    let config = getFirebaseConfig();
    if (!config || !config.apiKey) {
      if (!isLocalhost()) {
        config = await loadFirebaseConfigFromFunction();
      }
    }
    if (!config || !config.apiKey) {
      if (isLocalhost()) {
        useMockAuth = true;
        mockUser = loadMockUser();
        setAuthState({ user: mockUser, error: null });
        return null;
      }
      setAuthState({ user: null, error: new Error('Firebase konfiguration mangler (VITE_FIREBASE_*)') });
      return null;
    }
    try {
      const app = await getFirebaseAppInstance();
      const sdk = await loadFirebaseSdk();
      authInstance = sdk.getAuth(app);
      try {
        await sdk.setPersistence(authInstance, sdk.browserLocalPersistence);
      } catch (error) {
        console.warn('Kunne ikke sætte persistence', error);
      }
      sdk.onAuthStateChanged(authInstance, (user) => setAuthState({ user, error: null }));
      try {
        await sdk.getRedirectResult(authInstance);
      } catch (error) {
        console.warn('Redirect login mislykkedes', error);
      }
      setAuthState({ user: authInstance.currentUser, error: null });
      return authInstance;
    } catch (error) {
      console.error('Auth init fejlede', error);
      setAuthState({ user: null, error });
      return null;
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

export async function loginWithProvider(providerId) {
  await initSharedAuth();
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
    await authModule.signInWithPopup(authInstance, provider);
  } catch (error) {
    console.warn('Popup login fejlede, prøver redirect', error);
    if (shouldFallbackToRedirect(error)) {
      await authModule.signInWithRedirect(authInstance, provider);
      return;
    }
    setAuthState({ user: null, error });
    throw error;
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
    await authModule.signOut(authInstance);
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
  const credential = await authModule.createUserWithEmailAndPassword(authInstance, cleanEmail, password);
  if (credential?.user) {
    await authModule.sendEmailVerification(credential.user);
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
  const credential = await authModule.signInWithEmailAndPassword(authInstance, cleanEmail, password);
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
  await authModule.sendPasswordResetEmail(authInstance, cleanEmail);
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
  await authModule.sendEmailVerification(authInstance.currentUser);
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
  await authModule.reload(authInstance.currentUser);
  setAuthState({ user: authInstance.currentUser, error: null });
  return authInstance.currentUser;
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
