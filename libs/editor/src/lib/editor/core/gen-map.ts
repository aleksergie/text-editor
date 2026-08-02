const TOMBSTONE = null;
const GEN_MAP_SIZE_THRESHOLD = 1000;

export function cloneMap<K, V>(
  map: Map<K, V>,
  minGenMapSize: number = GEN_MAP_SIZE_THRESHOLD,
): Map<K, V> {
  if (map instanceof GenMap) {
    return map.clone();
  }
  if (map.size < minGenMapSize) {
    return new Map(map);
  }
  return new GenMap<K, V>().init(new Map(map), undefined, map.size);
}

export class GenMap<K, V> implements Map<K, V> {
  _mutable = false;
  _old: undefined | ReadonlyMap<K, V> = undefined;
  _nursery: undefined | Map<K, typeof TOMBSTONE | V> = undefined;
  _size = 0;

  clone(): GenMap<K, V> {
    this._mutable = false;
    return new GenMap<K, V>().init(this._old, this._nursery, this._size);
  }

  init(
    old: undefined | ReadonlyMap<K, V>,
    nursery: undefined | Map<K, typeof TOMBSTONE | V>,
    size: number,
  ): this {
    this._old = old;
    this._nursery = nursery;
    this._size = size;
    return this;
  }

  get size(): number {
    return this._size;
  }

  getNursery(): Map<K, typeof TOMBSTONE | V> {
    if (!this._mutable) {
      this._mutable = true;
      const nursery = this._nursery;
      if (nursery !== undefined && nursery.size * 2 > this._size) {
        this.compact();
        this._mutable = true; // compact sets it to false
        this._nursery = new Map();
      } else {
        this._nursery = nursery ? new Map(nursery) : new Map();
      }
    } else if (this._nursery === undefined) {
      this._nursery = new Map();
    }
    return this._nursery as Map<K, typeof TOMBSTONE | V>;
  }

  compact(force?: boolean): void {
    if (!force && (this._nursery === undefined || this._nursery.size === 0)) {
      return;
    }
    const compacted = new Map<K, V>();
    if (this._old !== undefined) {
      for (const [k, v] of this._old) {
        if (this._nursery !== undefined && this._nursery.has(k)) {
          const nv = this._nursery.get(k);
          if (nv !== TOMBSTONE) {
            compacted.set(k, nv as V);
          }
        } else {
          compacted.set(k, v);
        }
      }
    }
    if (this._nursery !== undefined) {
      for (const [k, v] of this._nursery) {
        if (v !== TOMBSTONE && (this._old === undefined || !this._old.has(k))) {
          compacted.set(k, v as V);
        }
      }
    }
    this._old = compacted;
    this._nursery = undefined;
    this._mutable = false;
    this._size = compacted.size;
  }

  clear(): void {
    this._old = undefined;
    this._nursery = undefined;
    this._mutable = false;
    this._size = 0;
  }

  delete(key: K): boolean {
    if (!this.has(key)) {
      return false;
    }
    const nursery = this.getNursery();
    if (this._old !== undefined && this._old.has(key)) {
      nursery.set(key, TOMBSTONE);
    } else {
      nursery.delete(key);
    }
    this._size -= 1;
    return true;
  }

  get(key: K): V | undefined {
    if (this._nursery !== undefined && this._nursery.has(key)) {
      const v = this._nursery.get(key);
      return v === TOMBSTONE ? undefined : (v as V);
    }
    if (this._old !== undefined) {
      return this._old.get(key);
    }
    return undefined;
  }

  has(key: K): boolean {
    if (this._nursery !== undefined && this._nursery.has(key)) {
      return this._nursery.get(key) !== TOMBSTONE;
    }
    if (this._old !== undefined) {
      return this._old.has(key);
    }
    return false;
  }

  set(key: K, value: V): this {
    const nursery = this.getNursery();
    if (!this.has(key)) {
      this._size += 1;
    }
    nursery.set(key, value);
    return this;
  }

  *entries(): IterableIterator<[K, V]> {
    if (this._old !== undefined) {
      for (const [k, v] of this._old) {
        if (this._nursery !== undefined && this._nursery.has(k)) {
          const nv = this._nursery.get(k);
          if (nv !== TOMBSTONE) {
            yield [k, nv as V];
          }
        } else {
          yield [k, v];
        }
      }
    }
    if (this._nursery !== undefined) {
      for (const [k, v] of this._nursery) {
        if (v !== TOMBSTONE && (this._old === undefined || !this._old.has(k))) {
          yield [k, v as V];
        }
      }
    }
  }

  *keys(): IterableIterator<K> {
    for (const [k] of this.entries()) {
      yield k;
    }
  }

  *values(): IterableIterator<V> {
    for (const [, v] of this.entries()) {
      yield v;
    }
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void {
    for (const [k, v] of this.entries()) {
      callbackfn.call(thisArg, v, k, this);
    }
  }

  get [Symbol.toStringTag]() {
    return 'GenMap';
  }
}
