import { useEffect, useRef, useState } from "react";

import type { Api, Page, SupportStaff } from "./types";
type StaffPage = Page<SupportStaff>;

interface Props {
  api: Api;
  onPage: (people: SupportStaff[], replace: boolean) => void;
  onSaved: (person: SupportStaff) => void;
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Unexpected error.";
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
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const alive = useRef(false);
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const retry = useRef<null | { append: boolean; all: boolean }>(null);

  async function load(append = false, all = false) {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError("");
    setNotice("");
    retry.current = null;
    const abort = new AbortController();
    controller.current = abort;
    let next = append ? cursor : null;
    let received: SupportStaff[] = [];
    try {
      do {
        const params = new URLSearchParams({ limit: "25" });
        if (next) params.set("cursor", next);
        const page = await api<StaffPage>(`/api/staff?${params}`, {
          signal: abort.signal,
        });
        if (!alive.current) return;
        received = merge(received, page.items);
        next = page.nextCursor;
      } while (all && next);
      setPeople((previous) => merge(append ? previous : [], received));
      setCursor(next);
      onPage(received, !append);
    } catch (failure) {
      if (alive.current && !abort.signal.aborted) {
        setError(`Could not load staff: ${message(failure)}`);
        retry.current = { append, all };
      }
    } finally {
      busy.current = false;
      if (alive.current) setLoading(false);
    }
  }

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);

  // The API has no name filter. Search completes the cursor scan before claiming no matches.
  useEffect(() => {
    if (query.trim() && cursor && !loading && !saving && !error)
      void load(true, true);
  }, [query, cursor, loading, saving, error]);

  async function save(
    path: string,
    method: string,
    body: object,
    created = false,
  ) {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    retry.current = null;
    try {
      const person = await api<SupportStaff>(path, {
        method,
        body: JSON.stringify(body),
      });
      if (!alive.current) return;
      setPeople((previous) => merge(previous, [person]));
      if (created) setName("");
      onSaved(person);
      setNotice(
        "Staff record saved. Existing assignments and historical values are retained.",
      );
    } catch (failure) {
      if (alive.current) setError(`Could not save staff: ${message(failure)}`);
    } finally {
      busy.current = false;
      if (alive.current) setSaving(false);
    }
  }

  function valid(value: string) {
    if (!value.trim() || value.trim().length > 120) {
      setError("Enter a staff name between 1 and 120 characters.");
      return false;
    }
    return true;
  }

  const visible = people.filter((person) =>
    `${person.name} ${person.id}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const disabled = loading || saving;
  return (
    <details id="staff-directory" className="staff-directory">
      <summary>Manage support staff</summary>
      <p className="muted">
        Directory records, not user accounts. Matching names may be different
        people; use their IDs to distinguish them.
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
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <p role="status">
        {loading
          ? "Loading staff..."
          : saving
            ? "Saving staff..."
            : `${visible.length} staff shown.${cursor ? " More staff are available." : ""}`}
      </p>
      {notice && <p role="status">{notice}</p>}
      {!loading &&
        !error &&
        !visible.length &&
        (!query.trim() || cursor === null) && (
          <p>
            {people.length ? "No matching staff." : "No staff records yet."}
          </p>
        )}
      <div aria-label="Staff records" aria-busy={disabled}>
        {visible.map((person) => (
          <StaffRow
            key={person.id}
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
          onClick={() => void load(true)}
        >
          Load more staff
        </button>
      )}
      {retry.current && (
        <button
          className="button button-secondary"
          disabled={disabled}
          onClick={() => {
            const pending = retry.current;
            if (pending) void load(pending.append, pending.all);
          }}
        >
          Retry loading staff
        </button>
      )}
      <button
        className="button button-secondary"
        disabled={disabled}
        onClick={() => void load()}
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
  useEffect(() => setName(person.name), [person.name]);
  return (
    <form
      className="staff-record"
      aria-label={`Staff ${person.name} ${person.id}`}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        rename(name);
      }}
    >
      <small>
        {person.active ? "Active" : "Inactive"} · {person.id}
      </small>
      <input
        aria-label={`Name for staff ${person.id}`}
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
