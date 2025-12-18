import { FIREBASE_SDK_VERSION, getFirebaseAppInstance } from './shared-auth.js';

let firestoreModule = null;
let firestoreDb = null;

async function loadFirestoreSdk() {
  if (firestoreModule) return firestoreModule;
  firestoreModule = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-firestore.js`);
  return firestoreModule;
}

export async function getFirestoreDb() {
  if (firestoreDb) return firestoreDb;
  const app = await getFirebaseAppInstance();
  const sdk = await loadFirestoreSdk();
  firestoreDb = sdk.getFirestore(app);
  return firestoreDb;
}

export async function getFirestoreHelpers() {
  const sdk = await loadFirestoreSdk();
  return sdk;
}

export function toIsoString(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === 'function') {
    try {
      return value.toDate().toISOString();
    } catch (error) {
      console.warn('Kunne ikke konvertere Firestore timestamp', error);
    }
  }
  if (typeof value === 'number') return new Date(value).toISOString();
  return value;
}
