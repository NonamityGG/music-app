// Minimal promise wrapper over IndexedDB. Holds imported MP3 files and their tags.

const DB_NAME = 'rezonans';
const VERSION = 1;
let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks', { keyPath: 'lid' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(store, mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const st = tx.objectStore(store);
        let result;
        const req = fn(st);
        if (req) req.onsuccess = () => (result = req.result);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
      })
  );
}

export const db = {
  put: (store, value, key) => run(store, 'readwrite', (st) => (key === undefined ? st.put(value) : st.put(value, key))),
  get: (store, key) => run(store, 'readonly', (st) => st.get(key)),
  all: (store) => run(store, 'readonly', (st) => st.getAll()),
  del: (store, key) => run(store, 'readwrite', (st) => st.delete(key)),
};

export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
  } catch {}
}

export async function storageEstimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
  } catch {}
  return null;
}
