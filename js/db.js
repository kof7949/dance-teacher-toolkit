// Minimal promise-based IndexedDB wrapper. No external deps.
const DB_NAME = 'dance-toolkit';
const DB_VERSION = 7;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('students')) {
        db.createObjectStore('students', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('skills')) {
        db.createObjectStore('skills', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('progress')) {
        const store = db.createObjectStore('progress', { keyPath: 'id' });
        store.createIndex('byStudent', 'studentId', { unique: false });
      }
      if (!db.objectStoreNames.contains('history')) {
        const store = db.createObjectStore('history', { keyPath: 'id' });
        store.createIndex('byStudent', 'studentId', { unique: false });
      }
      if (!db.objectStoreNames.contains('songs')) {
        db.createObjectStore('songs', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('counts')) {
        const store = db.createObjectStore('counts', { keyPath: 'id' });
        store.createIndex('bySong', 'songId', { unique: false });
      }
      if (!db.objectStoreNames.contains('categoryOrder')) {
        db.createObjectStore('categoryOrder', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('styles')) {
        db.createObjectStore('styles', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('routines')) {
        db.createObjectStore('routines', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('dancers')) {
        const store = db.createObjectStore('dancers', { keyPath: 'id' });
        store.createIndex('byRoutine', 'routineId', { unique: false });
      }
      if (!db.objectStoreNames.contains('formations')) {
        const store = db.createObjectStore('formations', { keyPath: 'id' });
        store.createIndex('byRoutine', 'routineId', { unique: false });
      }
      if (!db.objectStoreNames.contains('positions')) {
        const store = db.createObjectStore('positions', { keyPath: 'id' });
        store.createIndex('byFormation', 'formationId', { unique: false });
      }
      if (!db.objectStoreNames.contains('trainingSkills')) {
        db.createObjectStore('trainingSkills', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('trainingProgress')) {
        db.createObjectStore('trainingProgress', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('trainingHistory')) {
        const store = db.createObjectStore('trainingHistory', { keyPath: 'id' });
        store.createIndex('bySkill', 'skillId', { unique: false });
      }
      if (!db.objectStoreNames.contains('trainingJournal')) {
        db.createObjectStore('trainingJournal', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('trainingGoals')) {
        db.createObjectStore('trainingGoals', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('trainingReferences')) {
        db.createObjectStore('trainingReferences', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const DB = {
  uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  },
  async put(storeName, value) {
    const store = await tx(storeName, 'readwrite');
    await reqToPromise(store.put(value));
    return value;
  },
  async get(storeName, id) {
    const store = await tx(storeName, 'readonly');
    return reqToPromise(store.get(id));
  },
  async getAll(storeName) {
    const store = await tx(storeName, 'readonly');
    return reqToPromise(store.getAll());
  },
  async getAllByIndex(storeName, indexName, value) {
    const store = await tx(storeName, 'readonly');
    return reqToPromise(store.index(indexName).getAll(value));
  },
  async delete(storeName, id) {
    const store = await tx(storeName, 'readwrite');
    return reqToPromise(store.delete(id));
  },
};

window.DB = DB;
