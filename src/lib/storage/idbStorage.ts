import type { StateStorage } from 'zustand/middleware'

/**
 * IndexedDB-backed key/value storage for zustand `persist`, for state too large
 * for localStorage's ~5 MB quota (e.g. the ~170k-entry games DB). Plain (not
 * encrypted) — this is public data.
 */

const DB_NAME = 'deg-mods-kv'
const DB_VERSION = 1
const STORE = 'kv'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  return (dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }))
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE))
        req.onsuccess = () => resolve(req.result as T)
        req.onerror = () => reject(req.error)
      }),
  )
}

export const idbStorage: StateStorage = {
  getItem: (name) => run<string | undefined>('readonly', (s) => s.get(name)).then((v) => v ?? null).catch(() => null),
  setItem: (name, value) => run('readwrite', (s) => s.put(value, name)).then(() => undefined).catch(() => undefined),
  removeItem: (name) => run('readwrite', (s) => s.delete(name)).then(() => undefined).catch(() => undefined),
}
