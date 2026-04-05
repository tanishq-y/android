// In-memory TTL cache — used for server-side caching of alert checks.
// Key: string. Value: any. TTL: milliseconds.

export class Cache {
  constructor(ttlMs = 300_000) {
    this._store = new Map();
    this._ttl   = ttlMs;
  }

  get(key) {
    const entry = this._store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > this._ttl) {
      this._store.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key, data) {
    this._store.set(key, { data, cachedAt: Date.now() });
  }

  delete(key) {
    this._store.delete(key);
  }

  clear() {
    this._store.clear();
  }

  stats() {
    return {
      size: this._store.size,
      keys: Array.from(this._store.keys()),
    };
  }
}
