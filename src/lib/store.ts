// Keeps the imported C&E data in this browser (IndexedDB) so it is there next time the app opens.
// Nothing is uploaded anywhere: the workbooks are read inside the browser.
import type { Dataset } from './model';

const DB = 'ce-explorer';
const STORE = 'kv';
const KEY = 'dataset-v1';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadDataset(): Promise<Dataset | null> {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as Dataset) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function saveDataset(ds: Dataset): Promise<boolean> {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(ds, KEY);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

export function getPref(key: string): string | null {
  try {
    return localStorage.getItem('ce-explorer:' + key);
  } catch {
    return null;
  }
}

export function setPref(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem('ce-explorer:' + key);
    else localStorage.setItem('ce-explorer:' + key, value);
  } catch {
    /* storage unavailable: preferences just won't persist */
  }
}
