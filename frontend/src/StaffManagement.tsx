import { useCallback, useEffect, useRef, useState } from "react";

import type { Api, Page, SupportStaff } from "./types";
import { errorMessage } from "./useSession";

const STAFF_SEARCH_DEBOUNCE_MS = 250;

interface Props {
  api: Api;
  onPage: (people: SupportStaff[]) => void;
  onSaved: (person: SupportStaff) => void;
}

// Pages are ordered by ID, so keep that order when merging.
const merge = (previous: SupportStaff[], incoming: SupportStaff[]) =>
  [
    ...new Map(
      [...previous, ...incoming].map((person) => [person.id, person]),
    ).values(),
  ].sort((a, b) => a.id.localeCompare(b.id));

export function StaffManagement({ api, onPage, onSaved }: Props) {
  const [people, setPeople] = useState<SupportStaff[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // The cursor a failed load used, so "Retry" repeats exactly that request.
  const [retryFrom, setRetryFrom] = useState<string | null | undefined>();
  const inFlight = useRef<AbortController | null>(null);
  // Blocks a second save from a double click before React re-renders.
  const busy = useRef(false);
  const search = query.trim();

  const load = useCallback(
    async (text: string, after: string | null) => {
      if (busy.current) return;
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      setLoading(true);
      setError("");
      setRetryFrom(undefined);
      try {
        const params = new URLSearchParams({ limit: "25", q: text });
        if (after) params.set("cursor", after);
        const page = await api<Page<SupportStaff>>(`/api/staff?${params}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setPeople((previous) => merge(after ? previous : [], page.items));
        setCursor(page.nextCursor);
        setLoadedQuery(text);
        onPage(page.items);
      } catch (failure) {
        if (controller.signal.aborted) return;
        setError(`Could not load staff: ${errorMessage(failure)}`);
        setRetryFrom(after);
      } finally {
        if (inFlight.current === controller) setLoading(false);
      }
    },
    [api, onPage],
  );

  useEffect(() => {
    const timer = window.setTimeout(
      () => void load(search, null),
      STAFF_SEARCH_DEBOUNCE_MS,
    );
    return () => {
      window.clearTimeout(timer);
      inFlight.current?.abort();
    };
  }, [load, search]);

  const canLoadMore = cursor !== null && !loading && loadedQuery === search;

  async function save(
    path: string,
    method: string,
    body: object,
    created = false,
  ) {
    if (busy.current) return;
    busy.current = true;
    inFlight.current?.abort();
    setLoading(false);
    setSaving(true);
    setError("");
    setNotice("");
    setRetryFrom(undefined);
    try {
      const person = await api<SupportStaff>(path, {
        method,
        body: JSON.stringify(body),
      });
      setPeople((previous) =>
        merge(previous, [person]).filter((item) =>
          item.name.toLowerCase().includes(search.toLowerCase()),
        ),
      );
      if (created) setName("");
      onSaved(person);
      setNotice(
        "Staff saved.",
      );
    } catch (failure) {
      setError(`Could not save staff: ${errorMessage(failure)}`);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  function valid(value: string) {
    if (!value.trim() || value.trim().length > 120) {
      setError("Enter a staff name between 1 and 120 characters.");
      return false;
    }
    return true;
  }

  const disabled = loading || saving;
  return (
    <details id="staff-directory" className="staff-directory">
      <summary>Manage support staff</summary>
      <p className="muted">
        People that requests can be assigned to. They do not have logins.
      </p>
      <form
        id="staff-create-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (valid(name))
            void save("/api/staff", "POST", { name: name.trim() }, true);
        }}
      >
        <label className="form-field">
          <span>Staff name</span>
          <input
            value={name}
            maxLength={120}
            required
            disabled={disabled}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button className="button button-secondary" disabled={disabled}>
          Create staff
        </button>
      </form>
      <label className="form-field">
        <span>Search staff</span>
        <input
          type="search"
          value={query}
          disabled={saving}
          onChange={(event) => {
            // Clear the old results at once; the effect loads the new ones.
            setCursor(null);
            setPeople([]);
            setError("");
            setRetryFrom(undefined);
            setLoading(true);
            setQuery(event.target.value);
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <p role="status">
        {loading
          ? "Loading staff..."
          : saving
            ? "Saving staff..."
            : `${people.length} staff shown.${cursor ? " More staff are available." : ""}`}
      </p>
      {notice && <p role="status">{notice}</p>}
      {!loading &&
        !error &&
        !people.length &&
        (!search || cursor === null) && (
          <p>{search ? "No matching staff." : "No staff records yet."}</p>
        )}
      <div aria-label="Staff records" aria-busy={disabled}>
        {people.map((person) => (
          <StaffRow
            key={`${person.id}-${person.name}`}
            person={person}
            disabled={disabled}
            rename={(value) => {
              if (valid(value))
                void save(`/api/staff/${person.id}`, "PUT", {
                  name: value.trim(),
                });
            }}
            toggle={() =>
              void save(`/api/staff/${person.id}/active`, "PATCH", {
                active: !person.active,
              })
            }
          />
        ))}
      </div>
      {cursor && (
        <button
          className="button button-secondary"
          disabled={disabled}
          onClick={() => {
            if (canLoadMore) void load(search, cursor);
          }}
        >
          Load more staff
        </button>
      )}
      {retryFrom !== undefined && (
        <button
          className="button button-secondary"
          disabled={disabled}
          onClick={() => void load(search, retryFrom)}
        >
          Retry loading staff
        </button>
      )}
      <button
        className="button button-secondary"
        disabled={disabled}
        onClick={() => void load(search, null)}
      >
        Refresh staff
      </button>
    </details>
  );
}

function StaffRow({
  person,
  disabled,
  rename,
  toggle,
}: {
  person: SupportStaff;
  disabled: boolean;
  rename: (name: string) => void;
  toggle: () => void;
}) {
  const [name, setName] = useState(person.name);
  return (
    <form
      className="staff-record"
      aria-label={`Staff ${person.name}`}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        rename(name);
      }}
    >
      <small>
        {person.active ? "Active" : "Inactive"}
      </small>
      <input
        aria-label={`Name for ${person.name}`}
        value={name}
        required
        maxLength={120}
        disabled={disabled}
        onChange={(event) => setName(event.target.value)}
      />
      <button className="button button-secondary" disabled={disabled}>
        Save name
      </button>
      <button
        className="button button-secondary"
        type="button"
        disabled={disabled}
        onClick={toggle}
      >
        {person.active ? "Deactivate" : "Reactivate"}
      </button>
    </form>
  );
}
