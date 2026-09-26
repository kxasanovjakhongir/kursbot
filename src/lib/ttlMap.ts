/**
 * Muddati o'tgan yozuvlari o'zi o'chadigan Map. Xotirada vaqtinchalik holat saqlash uchun
 * (chek kutilayotgan fayl, admin kiritayotgan sabab, rate limit va h.k.) — xotira sizib ketmaydi.
 */
export class TtlMap<K, V> {
  private readonly items = new Map<K, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    /** Shundan oshsa eng eskilari o'chiriladi */
    private readonly maxSize = 10_000,
  ) {}

  get(key: K): V | undefined {
    const item = this.items.get(key);
    if (!item) return undefined;
    if (item.expiresAt <= Date.now()) {
      this.items.delete(key);
      return undefined;
    }
    return item.value;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  set(key: K, value: V, ttlMs = this.ttlMs): this {
    this.items.delete(key);
    this.items.set(key, { value, expiresAt: Date.now() + ttlMs });
    if (this.items.size > this.maxSize) this.sweep();
    return this;
  }

  delete(key: K): boolean {
    return this.items.delete(key);
  }

  /** Olib, darhol o'chiradi (bir martalik qiymatlar uchun) */
  take(key: K): V | undefined {
    const value = this.get(key);
    this.items.delete(key);
    return value;
  }

  get size(): number {
    return this.items.size;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.items) if (v.expiresAt <= now) this.items.delete(k);
    // Map qo'shilish tartibini saqlaydi — birinchilari eng eskilari
    for (const k of this.items.keys()) {
      if (this.items.size <= this.maxSize) break;
      this.items.delete(k);
    }
  }
}
