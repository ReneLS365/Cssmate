const DEFAULT_PROVIDER = 'custom';

function readWindowAuth() {
  if (typeof window === 'undefined') return null;
  const auth = window.cssmateAuth || window.CSSMATE_AUTH || null;
  if (!auth) return null;
  const current = auth.currentUser || auth.user || null;
  if (current) return current;
  if (typeof auth.getCurrentUser === 'function') return auth.getCurrentUser();
  return null;
}

export function getAuthContext() {
  const user = readWindowAuth();
  if (!user) {
    return { isAuthenticated: false, user: null, providers: [], message: 'Log ind for at se delte sager.' };
  }
  return {
    isAuthenticated: true,
    user: normalizeUser(user),
    providers: Array.isArray(user.providerData) ? user.providerData : [],
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
  if (user.displayName) return user.displayName;
  if (user.email) return user.email;
  if (user.uid) return user.uid;
  return 'Ukendt bruger';
}

function normalizeUser(user) {
  return {
    uid: user.uid || user.id || user.email || 'user',
    email: user.email || '',
    displayName: user.displayName || user.name || '',
    providerId: user.providerId || user.provider || DEFAULT_PROVIDER,
    role: user.role || user.claims?.role || null,
  };
}
