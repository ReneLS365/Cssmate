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

function wrapOnSnapshot(original) {
  return (...args) => {
    const path = inferPath(args);
    const nextArgs = [...args];
    const observerIndex = nextArgs.findIndex(arg => arg && typeof arg === 'object' && (typeof arg.next === 'function' || typeof arg.error === 'function'));
    if (observerIndex !== -1) {
      const observer = nextArgs[observerIndex];
      nextArgs[observerIndex] = {
        ...observer,
        error: (error) => {
          setLastFirestoreError(error, path);
          if (typeof observer.error === 'function') observer.error(error);
        },
      };
      if (!observer.error) {
        nextArgs[observerIndex].error = (error) => setLastFirestoreError(error, path);
      }
      return original(...nextArgs);
    }
    const errorHandlerIndex = nextArgs.findIndex((arg, index) => index > 0 && typeof arg === 'function' && (index === nextArgs.length - 1 || typeof nextArgs[index + 1] !== 'function'));
    if (errorHandlerIndex !== -1) {
      const handler = nextArgs[errorHandlerIndex];
      nextArgs[errorHandlerIndex] = (error) => {
        setLastFirestoreError(error, path);
        handler(error);
      };
      return original(...nextArgs);
    }
    const onNextIndex = nextArgs.findIndex((arg, index) => index > 0 && typeof arg === 'function');
    if (onNextIndex !== -1) {
      nextArgs.splice(onNextIndex + 1, 0, (error) => setLastFirestoreError(error, path));
      return original(...nextArgs);
    }
    nextArgs.push(() => {}, (error) => setLastFirestoreError(error, path));
    return original(...nextArgs);
  };
}

function createTrackedHelpers(sdk) {
  const tracked = { ...sdk };
  const methodsToWrap = ['getDoc', 'setDoc', 'updateDoc', 'deleteDoc', 'getDocs', 'addDoc', 'runTransaction'];
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
  if (typeof sdk.onSnapshot === 'function') {
    tracked.onSnapshot = wrapOnSnapshot(sdk.onSnapshot.bind(sdk));
  }
  return tracked;
}
