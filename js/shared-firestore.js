import { FIREBASE_SDK_VERSION, getFirebaseAppInstance } from './shared-auth.js';
import { setLastFirestoreError } from '../src/state/debug.js';

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
  return createTrackedHelpers(sdk);
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

function inferPath(args = []) {
  const first = args[0];
  if (first?.path) return first.path;
  if (first?.parent?.path) return first.parent.path;
  if (typeof first === 'string') return first;
  return '';
}

function createTrackedHelpers(sdk) {
  const tracked = { ...sdk };
  const methodsToWrap = ['getDoc', 'setDoc', 'updateDoc', 'deleteDoc', 'getDocs', 'addDoc'];
  methodsToWrap.forEach(methodName => {
    const original = sdk[methodName];
    if (typeof original !== 'function') return;
    tracked[methodName] = (...args) => {
      try {
        const result = original(...args);
        if (result && typeof result.then === 'function') {
          return result.catch(error => {
            setLastFirestoreError(error, inferPath(args));
            throw error;
          });
        }
        return result;
      } catch (error) {
        setLastFirestoreError(error, inferPath(args));
        throw error;
      }
    };
  });
  return tracked;
}
