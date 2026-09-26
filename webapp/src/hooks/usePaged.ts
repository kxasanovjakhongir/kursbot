import { useCallback, useState } from "react";
import { api } from "../lib/api";
import type { Paged } from "../lib/types";
import { useQuery } from "./useQuery";

const PAGE_SIZE = 20;

/** Sahifalangan ro'yxat: birinchi sahifa keshlanadi, "Yana ko'rsatish" keyingilarini qo'shadi */
export function usePaged<T>(key: string, path: string) {
  const sep = path.includes("?") ? "&" : "?";
  const first = useQuery(key, () => api.get<Paged<T>>(`${path}${sep}page=1&pageSize=${PAGE_SIZE}`));
  const [extra, setExtra] = useState<{ items: T[]; page: number } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const page = extra?.page ?? 1;
  const pages = first.data?.pages ?? 1;
  const items = first.data ? [...first.data.items, ...(extra?.items ?? [])] : null;

  const loadMore = useCallback(() => {
    if (loadingMore) return;
    setLoadingMore(true);
    api
      .get<Paged<T>>(`${path}${sep}page=${page + 1}&pageSize=${PAGE_SIZE}`)
      .then((r) => setExtra((prev) => ({ items: [...(prev?.items ?? []), ...r.items], page: r.page })))
      .catch(() => undefined)
      .finally(() => setLoadingMore(false));
  }, [loadingMore, path, sep, page]);

  const reload = useCallback(() => {
    setExtra(null);
    first.reload();
  }, [first]);

  return { data: items, loading: first.loading, error: first.error, reload, hasMore: page < pages, loadMore, loadingMore };
}
