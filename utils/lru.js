/**
 * Least recently used cache bounded by the summed size of its values.
 */
export class LRU {
  /**
   * @param {number} maxSize - maximum summed size of all values
   * @param {(value:*) => number} sizeOf - size of one value
   */
  constructor(maxSize, sizeOf) {
    this.maxSize = maxSize;
    this.sizeOf = sizeOf;
    this.size = 0;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (entry === undefined) return undefined;
    // re-insert to mark as most recently used
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    this.delete(key);
    const size = this.sizeOf(value);
    if (size > this.maxSize) return value;

    this.map.set(key, { value, size });
    this.size += size;
    for (const [oldKey] of this.map) {
      if (this.size <= this.maxSize) break;
      this.delete(oldKey);
    }
    return value;
  }

  delete(key) {
    const entry = this.map.get(key);
    if (entry === undefined) return;
    this.map.delete(key);
    this.size -= entry.size;
  }

  clear() {
    this.map.clear();
    this.size = 0;
  }
}
