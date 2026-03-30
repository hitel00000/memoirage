/**
 * Storage abstraction layer
 * Supports IndexedDB (default) and Firestore (optional)
 */

const config = {
  useFirestore: false,
  userId: 'default-user'
};

let db = null;

const LINK_TYPE_MIGRATION_MAP = {
  'supports':   'support',
  'contrasts':  'contradict',
  'depends_on': 'derive',
  'duplicates': 'related',
  'derive':     'derive',
  'contradict': 'contradict',
  'support':    'support',
  'related':    'related'
};

// ==================== IndexedDB ====================

class IndexedDBStore {
  constructor() {
    this.dbName = 'Memoirage';
    this.version = 2;
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { this.db = request.result; resolve(); };
      request.onupgradeneeded = (event) => {
        const idb = event.target.result;
        const tx = event.target.transaction;

        if (!idb.objectStoreNames.contains('notes')) {
          const s = idb.createObjectStore('notes', { keyPath: 'id' });
          s.createIndex('status', 'status', { unique: false });
          s.createIndex('created_at', 'created_at', { unique: false });
        }
        if (!idb.objectStoreNames.contains('links')) {
          const s = idb.createObjectStore('links', { keyPath: 'id' });
          s.createIndex('source_id', 'source_id', { unique: false });
          s.createIndex('target_id', 'target_id', { unique: false });
        }
        if (!idb.objectStoreNames.contains('evolutions')) {
          const s = idb.createObjectStore('evolutions', { keyPath: 'id' });
          s.createIndex('source_id', 'source_id', { unique: false });
          s.createIndex('target_id', 'target_id', { unique: false });
        }
        // v1→v2 마이그레이션: link type 정규화
        if (event.oldVersion < 2 && idb.objectStoreNames.contains('links')) {
          const linkStore = tx.objectStore('links');
          linkStore.openCursor().onsuccess = (e) => {
            const cursor = e.target.result;
            if (!cursor) return;
            const link = cursor.value;
            const mapped = LINK_TYPE_MIGRATION_MAP[link.type] || 'related';
            if (mapped !== link.type) cursor.update({ ...link, type: mapped });
            cursor.continue();
          };
        }
      };
    });
  }

  _tx(stores, mode = 'readonly') { return this.db.transaction(stores, mode); }

  async saveNote(note) {
    return new Promise((resolve, reject) => {
      const req = this._tx(['notes'], 'readwrite').objectStore('notes').put({ ...note, updated_at: new Date().toISOString() });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getNotes(filters = {}) {
    return new Promise((resolve, reject) => {
      const req = this._tx(['notes']).objectStore('notes').getAll();
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        let r = req.result;
        if (filters.status) r = r.filter(n => n.status === filters.status);
        if (filters.include_deleted === false) r = r.filter(n => !n.deleted_at);
        if (filters.tag) r = r.filter(n => n.tags && n.tags.includes(filters.tag));
        if (filters.q) { const q = filters.q.toLowerCase(); r = r.filter(n => n.content && n.content.toLowerCase().includes(q)); }
        resolve(r);
      };
    });
  }

  async getNoteById(id) {
    return new Promise((resolve, reject) => {
      const req = this._tx(['notes']).objectStore('notes').get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
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
    return this.saveNote({ ...note, deleted_at: new Date().toISOString(), status: 'deleted' });
  }

  async saveLink(link) {
    return new Promise((resolve, reject) => {
      const req = this._tx(['links'], 'readwrite').objectStore('links').put({ ...link, created_at: link.created_at || new Date().toISOString() });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getLinks(filters = {}) {
    return new Promise((resolve, reject) => {
      const req = this._tx(['links']).objectStore('links').getAll();
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        let r = req.result;
        if (filters.source_id) r = r.filter(l => l.source_id === filters.source_id);
        if (filters.target_id) r = r.filter(l => l.target_id === filters.target_id);
        resolve(r);
      };
    });
  }

  async deleteLink(id) {
    return new Promise((resolve, reject) => {
      const req = this._tx(['links'], 'readwrite').objectStore('links').delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async saveEvolution(evo) {
    return new Promise((resolve, reject) => {
      const req = this._tx(['evolutions'], 'readwrite').objectStore('evolutions').put({ ...evo, evolved_at: evo.evolved_at || new Date().toISOString() });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getEvolutions(filters = {}) {
    return new Promise((resolve, reject) => {
      const req = this._tx(['evolutions']).objectStore('evolutions').getAll();
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        let r = req.result;
        if (filters.source_id) r = r.filter(e => e.source_id === filters.source_id);
        if (filters.target_id) r = r.filter(e => e.target_id === filters.target_id);
        resolve(r);
      };
    });
  }

  async deleteEvolution(id) {
    return new Promise((resolve, reject) => {
      const req = this._tx(['evolutions'], 'readwrite').objectStore('evolutions').delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async clear() {
    const stores = ['notes', 'links', 'evolutions'];
    const tx = this.db.transaction(stores, 'readwrite');
    return new Promise((resolve, reject) => {
      stores.forEach(s => tx.objectStore(s).clear());
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

// ==================== Firestore ====================

class FirestoreStore {
  constructor() { this.userId = config.userId; }

  async init() {
    try {
      if (!firebase.auth().currentUser) await firebase.auth().signInAnonymously();
      this.userId = firebase.auth().currentUser.uid;
      config.userId = this.userId;
    } catch (err) {
      console.warn('Firebase auth failed, using default user ID', err);
      this.userId = 'default-user';
    }
  }

  _col(name) { return firebase.firestore().collection('users').doc(this.userId).collection(name); }

  async saveNote(note) { return this._col('notes').doc(note.id).set({ ...note, updated_at: new Date() }); }

  async getNotes(filters = {}) {
    let q = this._col('notes');
    if (filters.status && filters.status !== 'all') q = q.where('status', '==', filters.status);
    if (filters.include_deleted === false) q = q.where('deleted_at', '==', null);
    const snap = await q.get();
    let r = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (filters.tag) r = r.filter(n => n.tags && n.tags.includes(filters.tag));
    if (filters.q) { const qt = filters.q.toLowerCase(); r = r.filter(n => n.content && n.content.toLowerCase().includes(qt)); }
    return r;
  }

  async getNoteById(id) { const d = await this._col('notes').doc(id).get(); return d.exists ? { id: d.id, ...d.data() } : null; }
  async updateNote(id, updates) { return this._col('notes').doc(id).update({ ...updates, updated_at: new Date() }); }
  async deleteNote(id) { return this.updateNote(id, { deleted_at: new Date(), status: 'deleted' }); }

  async saveLink(link) { return this._col('links').doc(link.id).set({ ...link, created_at: link.created_at || new Date() }); }

  async getLinks(filters = {}) {
    let q = this._col('links');
    if (filters.source_id) q = q.where('source_id', '==', filters.source_id);
    const snap = await q.get();
    let r = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (filters.target_id) r = r.filter(l => l.target_id === filters.target_id);
    return r;
  }

  async deleteLink(id) { return this._col('links').doc(id).delete(); }

  async saveEvolution(evo) { return this._col('evolutions').doc(evo.id).set({ ...evo, evolved_at: evo.evolved_at || new Date() }); }

  async getEvolutions(filters = {}) {
    let q = this._col('evolutions');
    if (filters.source_id) q = q.where('source_id', '==', filters.source_id);
    const snap = await q.get();
    let r = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (filters.target_id) r = r.filter(e => e.target_id === filters.target_id);
    return r;
  }

  async deleteEvolution(id) { return this._col('evolutions').doc(id).delete(); }

  async clear() {
    const cols = ['notes', 'links', 'evolutions'];
    const snaps = await Promise.all(cols.map(c => this._col(c).get()));
    const batch = firebase.firestore().batch();
    snaps.forEach(s => s.docs.forEach(d => batch.delete(d.ref)));
    return batch.commit();
  }
}

// ==================== Public API ====================

async function initDB() {
  try {
    db = config.useFirestore ? new FirestoreStore() : new IndexedDBStore();
    await db.init();
    console.log(`Initialized with ${config.useFirestore ? 'Firestore' : 'IndexedDB'} (v${db.version || '-'})`);
  } catch (err) {
    console.error('Failed to initialize database:', err);
    throw err;
  }
}

const _guard = () => { if (!db) throw new Error('DB not initialized'); };
async function saveNote(note)             { _guard(); return db.saveNote(note); }
async function getNotes(f = {})           { _guard(); return db.getNotes(f); }
async function getNoteById(id)            { _guard(); return db.getNoteById(id); }
async function updateNote(id, u)          { _guard(); return db.updateNote(id, u); }
async function deleteNote(id)             { _guard(); return db.deleteNote(id); }
async function saveLink(link)             { _guard(); return db.saveLink(link); }
async function getLinks(f = {})           { _guard(); return db.getLinks(f); }
async function deleteLink(id)             { _guard(); return db.deleteLink(id); }
async function saveEvolution(evo)         { _guard(); return db.saveEvolution(evo); }
async function getEvolutions(f = {})      { _guard(); return db.getEvolutions(f); }
async function deleteEvolution(id)        { _guard(); return db.deleteEvolution(id); }
async function clearDB()                  { _guard(); return db.clear(); }
function setConfig(c)                     { Object.assign(config, c); }
function getConfig()                      { return { ...config }; }
