import { useCallback, useEffect, useRef, useState } from "react";

import type { Api, Page } from "./types";
import { errorMessage } from "./helpers";

const SEARCH_DEBOUNCE_MS = 250;

interface Options<T> {
  path: string;
  /** Pages are ordered by this key, so it is also the order when merging. */
  key: (item: T) => string;
  /** Turns the search box text into the text sent to the server. */
  normalize: (query: string) => string;
  /** Tells whether a saved item still belongs in the list for this search. */
  matches: (item: T, search: string) => boolean;
  loadFailed: string;
  saveFailed: string;
  onPage?: (items: T[]) => void;
}

function merge<T>(previous: T[], incoming: T[], key: (item: T) => string) {
  return [
    ...new Map(
      [...previous, ...incoming].map((item) => [key(item), item]),
    ).values(),
  ].sort((a, b) => key(a).localeCompare(key(b)));
}

/**
 * Loads a searchable, cursor-paged list once the search stops changing,
 * and runs one save at a time. A new search or a save aborts the load in flight.
 */
export function usePagedList<T>(
  api: Api,
  { path, key, normalize, matches, loadFailed, saveFailed, onPage }: Options<T>,
) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // The first page loads on mount, so start in the loading state rather than showing "0 shown".
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // The cursor a failed load used, so "Retry" repeats exactly that request.
  const [retryFrom, setRetryFrom] = useState<string | null | undefined>();
  const inFlight = useRef<AbortController | null>(null);
  // Blocks a second save from a double click before React re-renders.
  const busy = useRef(false);
  const search = normalize(query);

  const load = useCallback(
    async (after: string | null) => {
      if (busy.current) return;
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      setLoading(true);
      setError("");
      setRetryFrom(undefined);
      try {
        const params = new URLSearchParams({ limit: "25", q: search });
        if (after) params.set("cursor", after);
        const page = await api<Page<T>>(`${path}?${params}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setItems((previous) => merge(after ? previous : [], page.items, key));
        setCursor(page.nextCursor);
        onPage?.(page.items);
      } catch (failure) {
        if (controller.signal.aborted) return;
        setError(`${loadFailed}: ${errorMessage(failure)}`);
        setRetryFrom(after);
      } finally {
        if (inFlight.current === controller) setLoading(false);
      }
    },
    [api, path, key, search, loadFailed, onPage],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(null), SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      inFlight.current?.abort();
    };
  }, [load]);

  // Runs one change at a time and reports whether it worked.
  async function run(action: () => Promise<void>, success: string) {
    if (busy.current) return false;
    busy.current = true;
    inFlight.current?.abort();
    setLoading(false);
    setSaving(true);
    setError("");
    setNotice("");
    setRetryFrom(undefined);
    try {
      await action();
      setNotice(success);
      return true;
    } catch (failure) {
      setError(`${saveFailed}: ${errorMessage(failure)}`);
      return false;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return {
    items,
    cursor,
    query,
    search,
    loading,
    saving,
    disabled: loading || saving,
    error,
    notice,
    retryFrom,
    setError,
    load,
    run,
    show: (item: T) =>
      setItems((previous) =>
        merge(previous, [item], key).filter((kept) => matches(kept, search)),
      ),
    changeQuery(text: string) {
      // Clear the old results at once; the effect loads the new ones.
      setCursor(null);
      setItems([]);
      setError("");
      setRetryFrom(undefined);
      setLoading(true);
      setQuery(text);
    },
  };
}
