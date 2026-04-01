type StoredSigningIdentity = {
  publicKeySpkiBase64: string;
  privateKeyPkcs8Base64: string;
  ecdhPublicKeySpkiBase64?: string;
  ecdhPrivateKeyPkcs8Base64?: string;
};

const DB_NAME = 'p2p-messenger';
const DB_VERSION = 1;
const STORE_NAME = 'secure-kv';
const SIGNING_IDENTITY_KEY = 'signing-identity-v1';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('Cannot open IndexedDB.'));
    };
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const database = await openDatabase();
  try {
    return await new Promise<T | null>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => {
        resolve((request.result as T | undefined) ?? null);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('Cannot read from IndexedDB.'));
      };
    });
  } finally {
    database.close();
  }
}

async function idbSet<T>(key: string, value: T): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.put(value, key);
      transaction.oncomplete = () => {
        resolve();
      };
      transaction.onerror = () => {
        reject(transaction.error ?? new Error('Cannot write to IndexedDB.'));
      };
      transaction.onabort = () => {
        reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
      };
    });
  } finally {
    database.close();
  }
}

function isStoredSigningIdentity(value: unknown): value is StoredSigningIdentity {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<StoredSigningIdentity>;
  return (
    typeof candidate.publicKeySpkiBase64 === 'string' &&
    candidate.publicKeySpkiBase64.length > 0 &&
    typeof candidate.privateKeyPkcs8Base64 === 'string' &&
    candidate.privateKeyPkcs8Base64.length > 0 &&
    (candidate.ecdhPublicKeySpkiBase64 === undefined ||
      (typeof candidate.ecdhPublicKeySpkiBase64 === 'string' &&
        candidate.ecdhPublicKeySpkiBase64.length > 0)) &&
    (candidate.ecdhPrivateKeyPkcs8Base64 === undefined ||
      (typeof candidate.ecdhPrivateKeyPkcs8Base64 === 'string' &&
        candidate.ecdhPrivateKeyPkcs8Base64.length > 0))
  );
}

export async function readSigningIdentityFromIndexedDb(): Promise<StoredSigningIdentity | null> {
  const value = await idbGet<unknown>(SIGNING_IDENTITY_KEY);
  if (!isStoredSigningIdentity(value)) {
    return null;
  }
  return value;
}

export async function writeSigningIdentityToIndexedDb(
  value: StoredSigningIdentity
): Promise<void> {
  await idbSet<StoredSigningIdentity>(SIGNING_IDENTITY_KEY, value);
}

export async function migrateSigningIdentityFromSessionStorage(
  publicKeyStorageKey: string,
  privateKeyStorageKey: string
): Promise<StoredSigningIdentity | null> {
  const publicKeySpkiBase64 = sessionStorage.getItem(publicKeyStorageKey);
  const privateKeyPkcs8Base64 = sessionStorage.getItem(privateKeyStorageKey);
  if (!publicKeySpkiBase64 || !privateKeyPkcs8Base64) {
    return null;
  }

  const migrated: StoredSigningIdentity = {
    publicKeySpkiBase64,
    privateKeyPkcs8Base64
  };
  await writeSigningIdentityToIndexedDb(migrated);
  sessionStorage.removeItem(publicKeyStorageKey);
  sessionStorage.removeItem(privateKeyStorageKey);
  return migrated;
}
