import { GenMap, cloneMap } from './gen-map';

describe('GenMap', () => {
  it('should initialize empty', () => {
    const map = new GenMap<string, number>();
    expect(map.size).toBe(0);
    expect(map.has('foo')).toBe(false);
    expect(map.get('foo')).toBeUndefined();
  });

  it('should set, get, and has', () => {
    const map = new GenMap<string, number>();
    map.set('a', 1);
    expect(map.size).toBe(1);
    expect(map.has('a')).toBe(true);
    expect(map.get('a')).toBe(1);
  });

  it('should handle updates', () => {
    const map = new GenMap<string, number>();
    map.set('a', 1);
    map.set('a', 2);
    expect(map.size).toBe(1);
    expect(map.get('a')).toBe(2);
  });

  it('should delete keys properly', () => {
    const map = new GenMap<string, number>();
    map.set('a', 1);
    map.set('b', 2);
    
    expect(map.delete('a')).toBe(true);
    expect(map.delete('c')).toBe(false);
    
    expect(map.size).toBe(1);
    expect(map.has('a')).toBe(false);
    expect(map.get('a')).toBeUndefined();
  });

  it('should clone lazily and isolate mutations', () => {
    const original = new GenMap<string, number>();
    original.set('a', 1);
    original.set('b', 2);

    const clone = original.clone();
    expect(clone.size).toBe(2);
    expect(clone.get('a')).toBe(1);

    // Mutate original
    original.set('a', 10);
    original.delete('b');
    original.set('c', 3);

    expect(original.size).toBe(2);
    expect(original.get('a')).toBe(10);
    expect(original.has('b')).toBe(false);
    expect(original.get('c')).toBe(3);

    // Clone should remain untouched
    expect(clone.size).toBe(2);
    expect(clone.get('a')).toBe(1);
    expect(clone.has('b')).toBe(true);
    expect(clone.has('c')).toBe(false);
  });

  it('should compact when nursery grows too large', () => {
    const original = new GenMap<string, number>();
    original.set('a', 1);
    
    const clone = original.clone(); // both sharing old, nursery is empty
    
    // Mutate clone heavily to trigger compaction
    clone.set('b', 2);
    clone.set('c', 3); // size = 3, nursery size = 2 (which is > size * 2?)
    // size = 1 initially. 
    // Wait, compact condition is: nursery.size * 2 > this._size
    // After adding 'b': nursery.size = 1. this._size = 2. 1 * 2 = 2. Not > 2.
    // After adding 'c': nursery.size = 2. this._size = 3. 2 * 2 = 4 > 3! Compaction!
    expect(clone.size).toBe(3);
    
    // Verify values still intact
    expect(clone.get('a')).toBe(1);
    expect(clone.get('b')).toBe(2);
    expect(clone.get('c')).toBe(3);
    
    // Original untouched
    expect(original.size).toBe(1);
    expect(original.has('b')).toBe(false);
  });

  it('should iterate entries in proper order', () => {
    const map = new GenMap<string, number>();
    map.set('a', 1);
    map.set('b', 2);
    map.set('c', 3);
    
    const clone = map.clone();
    clone.delete('b');
    clone.set('d', 4);
    clone.set('a', 10); // Update existing key

    const entries = Array.from(clone.entries());
    // Lexical's GenMap yields old keys first (a, c) then new (d)
    expect(entries).toEqual([
      ['a', 10],
      ['c', 3],
      ['d', 4],
    ]);
  });
  
  describe('cloneMap', () => {
    it('returns Map if size < threshold', () => {
      const nativeMap = new Map([['a', 1]]);
      const cloned = cloneMap(nativeMap, 1000);
      expect(cloned instanceof GenMap).toBe(false);
      expect(cloned).toBeInstanceOf(Map);
      expect(cloned).not.toBe(nativeMap);
      expect(cloned.get('a')).toBe(1);
    });

    it('returns GenMap if size >= threshold', () => {
      const nativeMap = new Map([['a', 1]]);
      const cloned = cloneMap(nativeMap, 1); // threshold is 1
      expect(cloned instanceof GenMap).toBe(true);
      expect(cloned.get('a')).toBe(1);
    });

    it('returns GenMap clone if passed a GenMap', () => {
      const genMap = new GenMap<string, number>();
      genMap.set('a', 1);
      const cloned = cloneMap(genMap, 1000);
      expect(cloned instanceof GenMap).toBe(true);
      expect(cloned).not.toBe(genMap);
      expect(cloned.get('a')).toBe(1);
      
      cloned.set('b', 2);
      expect(genMap.has('b')).toBe(false);
    });
  });
});
