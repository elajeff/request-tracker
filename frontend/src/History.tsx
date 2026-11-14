import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { Api, Page, RequestHistoryEntry, ServiceRequest } from "./types";
import { errorMessage, label, uniqueById } from "./helpers";

const historyValue = (field: string, value: string | null) =>
  value === null
    ? "Unassigned"
    : field === "STATUS" || field === "PRIORITY"
      ? label(value)
      : value;

export function History({
  request,
  api,
}: {
  request: ServiceRequest;
  api: Api;
}) {
  const [entries, setEntries] = useState<RequestHistoryEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const reloadAfterLoad = useRef(false);
  const details = useRef<HTMLDetailsElement>(null);
  const reload = useEffectEvent(() => {
    if (!details.current?.open) return;
    if (lock.current) reloadAfterLoad.current = true;
    else if (loaded) void load();
  });
  // These are the fields that write history entries.
  useEffect(() => {
    reload();
  }, [
    request.title,
    request.description,
    request.status,
    request.priority,
    request.assigneeId,
  ]);
  async function load(append = false) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "25" });
      if (append && cursor) params.set("cursor", cursor);
      const page = await api<Page<RequestHistoryEntry>>(
        `/api/requests/${request.id}/history?${params}`,
      );
      setEntries((previous) =>
        uniqueById([...(append ? previous : []), ...page.items]),
      );
      setCursor(page.nextCursor);
      setLoaded(true);
    } catch (failure) {
      setError(`Could not load history: ${errorMessage(failure)}`);
    } finally {
      lock.current = false;
      setBusy(false);
      if (reloadAfterLoad.current) {
        reloadAfterLoad.current = false;
        void load();
      }
    }
  }
  return (
    <details
      className="request-history"
      ref={details}
      onToggle={(event) => {
        if (event.currentTarget.open && !loaded) void load();
      }}
    >
      <summary>Change history</summary>
      <button
        className="button button-secondary"
        disabled={busy}
        onClick={() => void load()}
      >
        Refresh history
      </button>
      <ol
        className="history-list"
        aria-label={`Change history for ${request.title}`}
      >
        {entries.map((entry) => (
          <li className="history-entry" key={entry.id}>
            <strong>
              {new Date(entry.changedAt).toLocaleString()} ·{" "}
              {entry.field.toLowerCase()} ·{" "}
              {entry.actorUsername ?? "Actor not recorded"}
            </strong>
            <p>
              {entry.field === "CREATED"
                ? `Created: ${entry.newValue}`
                : `${historyValue(entry.field, entry.oldValue)} → ${historyValue(entry.field, entry.newValue)}`}
            </p>
          </li>
        ))}
      </ol>
      <p role="status">
        {busy
          ? "Loading history…"
          : error || (loaded && !entries.length ? "No recorded changes." : "")}
      </p>
      {cursor && (
        <button
          className="button button-secondary"
          disabled={busy}
          onClick={() => void load(true)}
        >
          Load older changes
        </button>
      )}
    </details>
  );
}
