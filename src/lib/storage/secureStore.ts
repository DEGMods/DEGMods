/**
 * Encrypted key/value store backed by IndexedDB.
 *
 * Values are encrypted with AES-GCM using a per-device key that is generated
 * **non-extractable** and kept inside IndexedDB as an opaque `CryptoKey`: its
 * raw bytes are never exposed to JS. This is "secure at rest": the stored blob
 * is meaningless without the key, and the key can't be exfiltrated as bytes.
 *
 * It is NOT a defense against active XSS (a script on this origin can still call
 * these helpers), but it's a meaningful step up from plaintext localStorage for
 * sensitive session material.
 */

const DB_NAME = 'deg-mods-secure'
const DB_VERSION = 1
const DATA_STORE = 'kv'
const KEY_STORE = 'keys'
const KEY_ID = 'aes-gcm'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(DATA_STORE)) db.createObjectStore(DATA_STORE)
      if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}

function idbPut(db: IDBDatabase, store: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function idbDelete(db: IDBDatabase, store: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function getDeviceKey(db: IDBDatabase): Promise<CryptoKey> {
  const existing = await idbGet<CryptoKey>(db, KEY_STORE, KEY_ID)
  if (existing) return existing
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable
    ['encrypt', 'decrypt'],
  )
  await idbPut(db, KEY_STORE, KEY_ID, key)
  return key
}

interface EncryptedRecord {
  iv: Uint8Array
  data: ArrayBuffer
}

export async function secureSet(name: string, value: unknown): Promise<void> {
  const db = await openDb()
  try {
    const key = await getDeviceKey(db)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const plaintext = new TextEncoder().encode(JSON.stringify(value))
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
    await idbPut(db, DATA_STORE, name, { iv, data } satisfies EncryptedRecord)
  } finally {
    db.close()
  }
}

export async function secureGet<T>(name: string): Promise<T | null> {
  let db: IDBDatabase | null = null
  try {
    db = await openDb()
    const rec = await idbGet<EncryptedRecord>(db, DATA_STORE, name)
    if (!rec) return null
    const key = await getDeviceKey(db)
    const iv = new Uint8Array(rec.iv)
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, rec.data)
    return JSON.parse(new TextDecoder().decode(plaintext)) as T
  } catch {
    return null
  } finally {
    db?.close()
  }
}

export async function secureRemove(name: string): Promise<void> {
  let db: IDBDatabase | null = null
  try {
    db = await openDb()
    await idbDelete(db, DATA_STORE, name)
  } catch {
    // ignore
  } finally {
    db?.close()
  }
}
