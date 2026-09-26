import { useCallback, useEffect, useRef, useState } from "react";

export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
  reload: () => void;
  setData: (updater: (prev: T | null) => T | null) => void;
}

/**
 * Ma'lumot yuklash: loading / error / reload. Oxirgi natija kalit bo'yicha xotirada saqlanadi —
 * sahifaga qaytilganda darhol ko'rinadi, orqada yangilanadi (tezkor navigatsiya).
 */
const cache = new Map<string, unknown>();

export function useQuery<T>(key: string | null, fn: () => Promise<T>): QueryState<T> {
  const [data, setDataState] = useState<T | null>(() => (key ? ((cache.get(key) as T | undefined) ?? null) : null));
  const [loading, setLoading] = useState(key !== null && !cache.has(key));
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    const cached = cache.get(key) as T | undefined;
    setDataState(cached ?? null);
    setLoading(cached === undefined);
    setError(null);
    fnRef
      .current()
      .then((d) => {
        if (cancelled) return;
        cache.set(key, d);
        setDataState(d);
      })
      .catch((e: unknown) => !cancelled && setError(e))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [key, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback(
    (updater: (prev: T | null) => T | null) => {
      setDataState((prev) => {
        const next = updater(prev);
        if (key) {
          if (next === null) cache.delete(key);
          else cache.set(key, next);
        }
        return next;
      });
    },
    [key],
  );
  return { data, loading, error, reload, setData };
}

/** Boshqa sahifadagi ma'lumot eskirganda (masalan, buyurtma yaratilgach) */
export function invalidate(prefix: string): void {
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}
