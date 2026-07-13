/**
 * Jarvis Memory System
 * Shared memory layer for desktop + mobile.
 * Stores facts, conversations, user preferences, and learned behaviors.
 * Syncs between devices via a sync adapter (file, cloud, or bridge).
 */

export class MemorySystem {
  constructor(options = {}) {
    this.store = new Map();
    this.namespaces = new Map();
    this.syncAdapter = options.syncAdapter || null;
    this.maxEntries = options.maxEntries || 10000;
    this.ready = false;
  }

  async init() {
    if (this.syncAdapter) {
      const data = await this.syncAdapter.load();
      if (data) this._hydrate(data);
    }
    this.ready = true;
    return this;
  }

  _hydrate(data) {
    if (data.store) {
      for (const [k, v] of Object.entries(data.store)) {
        this.store.set(k, v);
      }
    }
    if (data.namespaces) {
      for (const [ns, entries] of Object.entries(data.namespaces)) {
        this.namespaces.set(ns, new Map(Object.entries(entries)));
      }
    }
  }

  _snapshot() {
    const store = {};
    for (const [k, v] of this.store) store[k] = v;
    const namespaces = {};
    for (const [ns, map] of this.namespaces) {
      namespaces[ns] = {};
      for (const [k, v] of map) namespaces[ns][k] = v;
    }
    return { store, namespaces };
  }

  async persist() {
    if (this.syncAdapter) {
      await this.syncAdapter.save(this._snapshot());
    }
  }

  // --- Fact memory (key-value) ---

  remember(key, value, ttl = 0) {
    const entry = { value, timestamp: Date.now(), ttl };
    this.store.set(key, entry);
    if (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      this.store.delete(oldest);
    }
    this.persist();
    return value;
  }

  recall(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.ttl > 0 && Date.now() - entry.timestamp > entry.ttl) {
      this.store.delete(key);
      this.persist();
      return null;
    }
    return entry.value;
  }

  forget(key) {
    this.store.delete(key);
    this.persist();
  }

  clear() {
    this.store.clear();
    this.namespaces.clear();
    this.persist();
  }

  // --- Namespaced memory (for skills, contexts) ---

  namespace(name) {
    if (!this.namespaces.has(name)) {
      this.namespaces.set(name, new Map());
    }
    return new NamespaceProxy(this.namespaces.get(name), name, this);
  }

  // --- Conversation history ---

  async addConversationEntry(role, content, metadata = {}) {
    const conv = this.namespace('conversations');
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    conv.set(id, { role, content, metadata, timestamp: Date.now() });
    
    // Prune old conversations
    const all = conv.all();
    if (all.length > 200) {
      const sorted = all.sort((a, b) => a.timestamp - b.timestamp);
      const toRemove = sorted.slice(0, all.length - 200);
      for (const entry of toRemove) conv.delete(entry.key);
    }
    return id;
  }

  getRecentConversations(count = 20) {
    const conv = this.namespace('conversations');
    return conv.all()
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, count)
      .reverse();
  }

  // --- User preferences ---

  setPreference(key, value) {
    return this.remember(`pref:${key}`, value);
  }

  getPreference(key) {
    return this.recall(`pref:${key}`);
  }

  // --- Learned patterns ---

  learnPattern(pattern, response) {
    const patterns = this.namespace('patterns');
    patterns.set(pattern, {
      response,
      count: (patterns.get(pattern)?.count || 0) + 1,
      lastUsed: Date.now()
    });
  }

  matchPattern(input) {
    const patterns = this.namespace('patterns');
    for (const [pattern, data] of patterns.entries()) {
      if (input.toLowerCase().includes(pattern.toLowerCase())) {
        data.lastUsed = Date.now();
        patterns.set(pattern, data);
        return data.response;
      }
    }
    return null;
  }
}

class NamespaceProxy {
  constructor(map, name, parent) {
    this._map = map;
    this._name = name;
    this._parent = parent;
  }

  set(key, value) {
    this._map.set(key, value);
    this._parent.persist();
  }

  get(key) {
    return this._map.get(key);
  }

  delete(key) {
    this._map.delete(key);
    this._parent.persist();
  }

  has(key) {
    return this._map.has(key);
  }

  entries() {
    return this._map.entries();
  }

  all() {
    const result = [];
    for (const [key, value] of this._map) {
      result.push({ key, ...value, value });
    }
    return result;
  }

  clear() {
    this._map.clear();
    this._parent.persist();
  }
}

export default MemorySystem;