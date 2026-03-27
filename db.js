/**
 * Storage abstraction layer
 * Supports IndexedDB (default) and Firestore (optional)
 * 
 * Usage:
 * - IndexedDB: Use as-is (no config needed)
 * - Firestore: Set config.useFirestore = true and load Firebase SDK
 */

const config = {
  useFirestore: false,  // Set to true to use Firestore, false for IndexedDB (default)
  userId: 'default-user'  // Will be set by Firebase auth or kept as default
};

let db = null;  // IndexedDB or Firestore reference

// ==================== IndexedDB ====================

class IndexedDBStore {
  constructor() {
    this.dbName = 'Memoirage';
    this.version = 1;
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create object stores
        if (!db.objectStoreNames.contains('notes')) {
          const noteStore = db.createObjectStore('notes', { keyPath: 'id' });
          noteStore.createIndex('status', 'status', { unique: false });
          noteStore.createIndex('created_at', 'created_at', { unique: false });
        }

        if (!db.objectStoreNames.contains('links')) {
          const linkStore = db.createObjectStore('links', { keyPath: 'id' });
          linkStore.createIndex('source_id', 'source_id', { unique: false });
          linkStore.createIndex('target_id', 'target_id', { unique: false });
        }
      };
    });
  }

  async saveNote(note) {
    const tx = this.db.transaction(['notes'], 'readwrite');
    const store = tx.objectStore('notes');
    return new Promise((resolve, reject) => {
      const request = store.put({
        ...note,
        updated_at: new Date().toISOString()
      });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async getNotes(filters = {}) {
    const tx = this.db.transaction(['notes'], 'readonly');
    const store = tx.objectStore('notes');
    const notes = [];

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        let results = request.result;

        // Apply filters
        if (filters.status) {
          results = results.filter(n => n.status === filters.status);
        }
        if (filters.include_deleted === false) {
          results = results.filter(n => n.deleted_at === null || !n.deleted_at);
        }
        if (filters.tag) {
          results = results.filter(n => n.tags && n.tags.includes(filters.tag));
        }
        if (filters.q) {
          const query = filters.q.toLowerCase();
          results = results.filter(n => n.content && n.content.toLowerCase().includes(query));
        }

        resolve(results);
      };
    });
  }

  async getNoteById(id) {
    const tx = this.db.transaction(['notes'], 'readonly');
    const store = tx.objectStore('notes');
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async updateNote(id, updates) {
    const note = await this.getNoteById(id);
    if (!note) throw new Error('Note not found');
    return this.saveNote({ ...note, ...updates });
  }

  async deleteNote(id) {
    const note = await this.getNoteById(id);
    if (!note) throw new Error('Note not found');
    return this.saveNote({
      ...note,
      deleted_at: new Date().toISOString(),
      status: 'deleted'
    });
  }

  async saveLink(link) {
    const tx = this.db.transaction(['links'], 'readwrite');
    const store = tx.objectStore('links');
    return new Promise((resolve, reject) => {
      const request = store.put({
        ...link,
        created_at: link.created_at || new Date().toISOString()
      });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async getLinks(filters = {}) {
    const tx = this.db.transaction(['links'], 'readonly');
    const store = tx.objectStore('links');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        let results = request.result;

        if (filters.source_id) {
          results = results.filter(l => l.source_id === filters.source_id);
        }
        if (filters.target_id) {
          results = results.filter(l => l.target_id === filters.target_id);
        }

        resolve(results);
      };
    });
  }

  async deleteLink(id) {
    const tx = this.db.transaction(['links'], 'readwrite');
    const store = tx.objectStore('links');
    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async clear() {
    const tx = this.db.transaction(['notes', 'links'], 'readwrite');
    return new Promise((resolve, reject) => {
      tx.objectStore('notes').clear();
      tx.objectStore('links').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

// ==================== Firestore ====================

class FirestoreStore {
  constructor() {
    this.userId = config.userId;
  }

  async init() {
    // Firestore is already initialized via Firebase SDK
    // Just verify auth or use anonymous
    try {
      if (!firebase.auth().currentUser) {
        await firebase.auth().signInAnonymously();
      }
      this.userId = firebase.auth().currentUser.uid;
      config.userId = this.userId;
    } catch (err) {
      console.warn('Firebase auth failed, using default user ID', err);
      this.userId = 'default-user';
    }
  }

  async saveNote(note) {
    const noteRef = firebase.firestore()
      .collection('users')
      .doc(this.userId)
      .collection('notes')
      .doc(note.id);

    return noteRef.set({
      ...note,
      updated_at: new Date()
    });
  }

  async getNotes(filters = {}) {
    let query = firebase.firestore()
      .collection('users')
      .doc(this.userId)
      .collection('notes');

    if (filters.status && filters.status !== 'all') {
      query = query.where('status', '==', filters.status);
    }

    if (filters.include_deleted === false) {
      query = query.where('deleted_at', '==', null);
    }

    const snapshot = await query.get();
    let results = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Client-side filtering for complex conditions
    if (filters.tag) {
      results = results.filter(n => n.tags && n.tags.includes(filters.tag));
    }
    if (filters.q) {
      const query_text = filters.q.toLowerCase();
      results = results.filter(n => n.content && n.content.toLowerCase().includes(query_text));
    }

    return results;
  }

  async getNoteById(id) {
    const noteRef = firebase.firestore()
      .collection('users')
      .doc(this.userId)
      .collection('notes')
      .doc(id);

    const doc = await noteRef.get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  }

  async updateNote(id, updates) {
    const noteRef = firebase.firestore()
      .collection('users')
      .doc(this.userId)
      .collection('notes')
      .doc(id);

    return noteRef.update({
      ...updates,
      updated_at: new Date()
    });
  }

  async deleteNote(id) {
    return this.updateNote(id, {
      deleted_at: new Date(),
      status: 'deleted'
    });
  }

  async saveLink(link) {
    const linkRef = firebase.firestore()
      .collection('users')
      .doc(this.userId)
      .collection('links')
      .doc(link.id);

    return linkRef.set({
      ...link,
      created_at: link.created_at || new Date()
    });
  }

  async getLinks(filters = {}) {
    let query = firebase.firestore()
      .collection('users')
      .doc(this.userId)
      .collection('links');

    if (filters.source_id) {
      query = query.where('source_id', '==', filters.source_id);
    }

    const snapshot = await query.get();
    let results = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (filters.target_id) {
      results = results.filter(l => l.target_id === filters.target_id);
    }

    return results;
  }

  async deleteLink(id) {
    return firebase.firestore()
      .collection('users')
      .doc(this.userId)
      .collection('links')
      .doc(id)
      .delete();
  }

  async clear() {
    // Delete all notes and links for current user
    const notesSnapshot = await firebase.firestore()
      .collection('users')
      .doc(this.userId)
      .collection('notes')
      .get();

    const linksSnapshot = await firebase.firestore()
      .collection('users')
      .doc(this.userId)
      .collection('links')
      .get();

    const batch = firebase.firestore().batch();

    notesSnapshot.docs.forEach(doc => batch.delete(doc.ref));
    linksSnapshot.docs.forEach(doc => batch.delete(doc.ref));

    return batch.commit();
  }
}

// ==================== Public API ====================

async function initDB() {
  try {
    if (config.useFirestore) {
      if (typeof firebase === 'undefined') {
        throw new Error('Firebase SDK not loaded. Load Firebase before setting useFirestore = true');
      }
      db = new FirestoreStore();
    } else {
      db = new IndexedDBStore();
    }
    await db.init();
    console.log(`Initialized with ${config.useFirestore ? 'Firestore' : 'IndexedDB'}`);
  } catch (err) {
    console.error('Failed to initialize database:', err);
    throw err;
  }
}

async function saveNote(note) {
  if (!db) throw new Error('Database not initialized. Call initDB() first.');
  return db.saveNote(note);
}

async function getNotes(filters = {}) {
  if (!db) throw new Error('Database not initialized. Call initDB() first.');
  return db.getNotes(filters);
}

async function getNoteById(id) {
  if (!db) throw new Error('Database not initialized. Call initDB() first.');
  return db.getNoteById(id);
}

async function updateNote(id, updates) {
  if (!db) throw new Error('Database not initialized. Call initDB() first.');
  return db.updateNote(id, updates);
}

async function deleteNote(id) {
  if (!db) throw new Error('Database not initialized. Call initDB() first.');
  return db.deleteNote(id);
}

async function saveLink(link) {
  if (!db) throw new Error('Database not initialized. Call initDB() first.');
  return db.saveLink(link);
}

async function getLinks(filters = {}) {
  if (!db) throw new Error('Database not initialized. Call initDB() first.');
  return db.getLinks(filters);
}

async function deleteLink(id) {
  if (!db) throw new Error('Database not initialized. Call initDB() first.');
  return db.deleteLink(id);
}

async function clearDB() {
  if (!db) throw new Error('Database not initialized. Call initDB() first.');
  return db.clear();
}

function setConfig(newConfig) {
  Object.assign(config, newConfig);
}

function getConfig() {
  return { ...config };
}
