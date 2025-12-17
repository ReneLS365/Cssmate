const DEFAULT_PROVIDER = 'custom';
const DEFAULT_ENABLED_PROVIDERS = ['google', 'microsoft'];
const FIREBASE_SDK_VERSION = '10.12.2';

let authInstance = null;
let authModule = null;
let initPromise = null;
let authReady = false;
let authError = null;
let currentUser = null;
let providerData = [];
const listeners = new Set();

function getFirebaseConfig() {
  if (typeof window === 'undefined') return null;
  if (window.FIREBASE_CONFIG && typeof window.FIREBASE_CONFIG === 'object') return window.FIREBASE_CONFIG;
  const scriptConfig = document.querySelector('script[data-firebase-config]');
  if (scriptConfig?.dataset?.firebaseConfig) {
    try {
      return JSON.parse(scriptConfig.dataset.firebaseConfig);
    } catch (error) {
      console.warn('Ugyldigt Firebase config i data-firebase-config', error);
    }
  }
  const metaConfig = document.querySelector('meta[name="firebase-config"]');
  if (metaConfig?.content) {
    try {
      return JSON.parse(metaConfig.content);
    } catch (error) {
      console.warn('Ugyldigt Firebase config i meta[name="firebase-config"]', error);
    }
  }
  return null;
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
  currentUser = user ? normalizeUser(user) : null;
  providerData = user?.providerData || [];
  authError = error || null;
  authReady = true;
  notify();
}

export async function initSharedAuth() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const config = getFirebaseConfig();
    if (!config) {
      setAuthState({ user: null, error: new Error('Firebase konfiguration mangler') });
      return null;
    }
    try {
      const sdk = await loadFirebaseSdk();
      const app = sdk.getApps?.().length ? sdk.getApp() : sdk.initializeApp(config);
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
  if (typeof window !== 'undefined' && Array.isArray(window.FIREBASE_AUTH_PROVIDERS)) {
    return window.FIREBASE_AUTH_PROVIDERS;
  }
  return DEFAULT_ENABLED_PROVIDERS;
}

function shouldFallbackToRedirect(error) {
  if (!error) return false;
  const code = error?.code || '';
  return code.includes('popup') || code === 'auth/cancelled-popup-request' || code === 'auth/popup-closed-by-user';
}

export async function loginWithProvider(providerId) {
  await initSharedAuth();
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
    return { isReady: false, isAuthenticated: false, user: null, providers: [], message: 'Login initialiseres…' };
  }
  if (authError) {
    return { isReady: true, isAuthenticated: false, user: null, providers: [], message: authError.message || 'Login-fejl' };
  }
  if (!currentUser) {
    return { isReady: true, isAuthenticated: false, user: null, providers: [], message: 'Log ind for at se delte sager.' };
  }
  return {
    isReady: true,
    isAuthenticated: true,
    user: currentUser,
    providers: Array.isArray(providerData) ? providerData : [],
    message: '',
  };
}

export function userIsAdmin(user) {
  const email = (user?.email || '').toLowerCase();
  const adminList = (() => {
    if (typeof window === 'undefined') return [];
    if (Array.isArray(window.SHARED_ADMIN_EMAILS)) return window.SHARED_ADMIN_EMAILS;
    return [];
  })();
  return Boolean(user?.role === 'admin' || (email && adminList.map(entry => entry.toLowerCase()).includes(email)));
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
  return {
    uid: user.uid || user.id || user.email || 'user',
    email: user.email || '',
    displayName: user.displayName || user.name || '',
    providerId: user.providerId || user.provider || primaryProvider?.providerId || DEFAULT_PROVIDER,
    role: user.role || user.claims?.role || null,
  };
}
