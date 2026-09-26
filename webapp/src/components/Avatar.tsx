import { useEffect, useState } from "react";
import { api } from "../lib/api";

// Rasm bir marta yuklanadi va barcha sahifalarda qayta ishlatiladi (null — rasm yo'q)
let photoPromise: Promise<string | null> | null = null;
const loadPhoto = () => (photoPromise ??= api.blobUrl("/me/photo").catch(() => null));

/** Foydalanuvchi rasmi (backend Bot API orqali). Yuklanmaguncha yoki yo'q bo'lsa — ism harfi */
export function Avatar({ name, size }: { name: string | null; size: "md" | "lg" }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadPhoto().then((url) => alive && setSrc(url));
    return () => {
      alive = false;
    };
  }, []);

  const box = size === "lg" ? "h-20 w-20 text-3xl" : "h-12 w-12 text-lg";
  if (src && !failed) return <img src={src} alt="" onError={() => setFailed(true)} className={`${box} shrink-0 rounded-full object-cover`} />;
  return (
    <span className={`${box} flex shrink-0 items-center justify-center rounded-full bg-button font-semibold text-button-text`}>
      {(name?.trim() || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}
