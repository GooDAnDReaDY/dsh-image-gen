// @ts-check
// gallery-store.js — IndexedDB workspace gallery store with tags, favorites, and tombstones (#508).
// Persists image metadata, tags, favorites, and tombstones while binary bytes stay in Attachment service.

export const DB_NAME = 'dsh_image_gen_db'
export const DB_VERSION = 4
export const STORE_NAME = 'gallery_history'
export const TOMBSTONE_STORE = 'gallery_tombstones'
export const FAV_PROMPT_STORE = 'favorite_prompts'
export const FAV_FOLDER_STORE = 'favorite_folders'

/**
 * In-memory fallback database for headless/Node environments or when IndexedDB is unavailable.
 */
class MemoryGalleryStore {
  constructor() {
    /** @type {Map<string, any>} */
    this.history = new Map()
    /** @type {Set<string>} */
    this.tombstones = new Set()
    /** @type {Map<string, any>} */
    this.favoritePrompts = new Map()
    /** @type {Map<string, any>} */
    this.favoriteFolders = new Map()
  }

  async addGalleryItem(item) {
    if (!item?.id) return false
    if (this.tombstones.has(item.id)) return false
    this.history.set(item.id, { ...item, createdAt: item.createdAt || Date.now() })
    return true
  }

  async getGalleryItems(filter = {}) {
    let list = Array.from(this.history.values())
    if (filter.favoriteOnly) {
      list = list.filter((it) => it.isFavorite)
    }
    if (filter.provider) {
      list = list.filter((it) => it.provider === filter.provider)
    }
    if (filter.tag) {
      list = list.filter((it) => Array.isArray(it.tags) && it.tags.includes(filter.tag))
    }
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    return list
  }

  async deleteGalleryItem(id) {
    this.tombstones.add(id)
    this.history.delete(id)
    return true
  }

  async toggleFavorite(id) {
    const item = this.history.get(id)
    if (!item) return false
    item.isFavorite = !item.isFavorite
    return item.isFavorite
  }

  async addTag(id, tag) {
    const item = this.history.get(id)
    if (!item) return false
    const tags = new Set(item.tags || [])
    tags.add(tag)
    item.tags = Array.from(tags)
    return true
  }

  async isTombstoned(id) {
    return this.tombstones.has(id)
  }

  async clearTombstones() {
    this.tombstones.clear()
  }
}

const memoryStore = new MemoryGalleryStore()

/**
 * Check if running in browser with IndexedDB support.
 */
function hasIndexedDB() {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined'
}

/**
 * @returns {Promise<IDBDatabase | MemoryGalleryStore>}
 */
export async function getGalleryDB() {
  if (!hasIndexedDB()) {
    return memoryStore
  }

  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = (event) => {
      // @ts-ignore
      const db = event.target?.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt', { unique: false })
      }
      if (!db.objectStoreNames.contains(TOMBSTONE_STORE)) {
        db.createObjectStore(TOMBSTONE_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(FAV_PROMPT_STORE)) {
        db.createObjectStore(FAV_PROMPT_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(FAV_FOLDER_STORE)) {
        db.createObjectStore(FAV_FOLDER_STORE, { keyPath: 'id' })
      }
    }

    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Add or update an image in the gallery store.
 * @param {any} item
 */
export async function addGalleryItem(item) {
  if (!item?.id) return false
  const db = await getGalleryDB()
  if (db instanceof MemoryGalleryStore) {
    return db.addGalleryItem(item)
  }

  // Check tombstone
  const isDead = await isTombstoned(item.id)
  if (isDead) return false

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.put({ ...item, createdAt: item.createdAt || Date.now() })
    req.onsuccess = () => resolve(true)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Retrieve items from gallery store.
 * @param {{ favoriteOnly?: boolean, provider?: string, tag?: string }} [filter]
 */
export async function getGalleryItems(filter = {}) {
  const db = await getGalleryDB()
  if (db instanceof MemoryGalleryStore) {
    return db.getGalleryItems(filter)
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req = store.getAll()
    req.onsuccess = () => {
      let list = req.result || []
      if (filter.favoriteOnly) {
        list = list.filter((it) => it.isFavorite)
      }
      if (filter.provider) {
        list = list.filter((it) => it.provider === filter.provider)
      }
      if (filter.tag) {
        list = list.filter((it) => Array.isArray(it.tags) && it.tags.includes(filter.tag))
      }
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      resolve(list)
    }
    req.onerror = () => reject(req.error)
  })
}

/**
 * Delete an item and mark tombstone so it won't be resurrected.
 * @param {string} id
 */
export async function deleteGalleryItem(id) {
  const db = await getGalleryDB()
  if (db instanceof MemoryGalleryStore) {
    return db.deleteGalleryItem(id)
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, TOMBSTONE_STORE], 'readwrite')
    tx.objectStore(STORE_NAME).delete(id)
    tx.objectStore(TOMBSTONE_STORE).put({ id, deletedAt: Date.now() })
    tx.oncomplete = () => resolve(true)
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Check if an item is tombstoned.
 * @param {string} id
 */
export async function isTombstoned(id) {
  const db = await getGalleryDB()
  if (db instanceof MemoryGalleryStore) {
    return db.isTombstoned(id)
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction([TOMBSTONE_STORE], 'readonly')
      const req = tx.objectStore(TOMBSTONE_STORE).get(id)
      req.onsuccess = () => resolve(Boolean(req.result))
      req.onerror = () => resolve(false)
    } catch {
      resolve(false)
    }
  })
}

/**
 * Toggle favorite status of a gallery item.
 * @param {string} id
 */
export async function toggleFavorite(id) {
  const db = await getGalleryDB()
  if (db instanceof MemoryGalleryStore) {
    return db.toggleFavorite(id)
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const getReq = store.get(id)
    getReq.onsuccess = () => {
      const item = getReq.result
      if (!item) {
        resolve(false)
        return
      }
      item.isFavorite = !item.isFavorite
      store.put(item)
      resolve(item.isFavorite)
    }
    getReq.onerror = () => reject(getReq.error)
  })
}
