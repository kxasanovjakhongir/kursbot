import { useCallback, useRef, useState } from "react";

/**
 * Tugma amali: bajarilayotganda qayta bosish e'tiborsiz qoldiriladi (dublikat so'rov yo'q),
 * `busy` — tugmani o'chirish va spinner uchun.
 */
export function useAction<A extends unknown[]>(fn: (...args: A) => Promise<void>): [(...args: A) => void, boolean] {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const run = useCallback(
    (...args: A) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      fn(...args).finally(() => {
        running.current = false;
        setBusy(false);
      });
    },
    [fn],
  );
  return [run, busy];
}
