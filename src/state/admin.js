const STORAGE_KEY = 'csmate.admin.unlocked';

let adminUnlocked = false;

function notifyChange () {
  if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
    const evt = new CustomEvent('csmate:admin-change', {
      detail: { unlocked: adminUnlocked }
    });
    document.dispatchEvent(evt);
  }
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('admin-unlocked', adminUnlocked);
  }
}

export function restoreAdminState () {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return false;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    adminUnlocked = stored === '1';
    notifyChange();
    return adminUnlocked;
  } catch (error) {
    console.warn('Kunne ikke genskabe admin-tilstand', error);
    return false;
  }
}

export function isAdminUnlocked () {
  return adminUnlocked;
}

export function setAdminOk (value) {
  adminUnlocked = Boolean(value);
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      if (adminUnlocked) localStorage.setItem(STORAGE_KEY, '1');
      else localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.warn('Kunne ikke gemme admin-tilstand', error);
    }
  }
  notifyChange();
}

export function setLock (element) {
  if (!element) return;
  const locked = !adminUnlocked;
  element.toggleAttribute('data-admin-locked', locked);
  if (locked) {
    element.setAttribute('aria-disabled', 'true');
  } else {
    element.removeAttribute('aria-disabled');
  }
}
