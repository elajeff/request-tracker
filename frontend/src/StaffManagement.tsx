import { useState } from "react";

import type { Api, SupportStaff } from "./types";
import { usePagedList } from "./usePagedList";

interface Props {
  api: Api;
  onPage: (people: SupportStaff[]) => void;
  onSaved: (person: SupportStaff) => void;
}

const staffId = (person: SupportStaff) => person.id;
const normalize = (query: string) => query.trim();
const matches = (person: SupportStaff, search: string) =>
  person.name.toLowerCase().includes(search.toLowerCase());

export function StaffManagement({ api, onPage, onSaved }: Props) {
  const {
    items: people,
    cursor,
    query,
    search,
    loading,
    saving,
    disabled,
    error,
    notice,
    retryFrom,
    setError,
    load,
    run,
    show,
    changeQuery,
  } = usePagedList<SupportStaff>(api, {
    path: "/api/staff",
    key: staffId,
    normalize,
    matches,
    loadFailed: "Could not load staff",
    saveFailed: "Could not save staff",
    onPage,
  });
  const [name, setName] = useState("");

  function save(path: string, method: string, body: object, created = false) {
    return run(async () => {
      const person = await api<SupportStaff>(path, {
        method,
        body: JSON.stringify(body),
      });
      show(person);
      if (created) setName("");
      onSaved(person);
    }, "Staff saved.");
  }

  function valid(value: string) {
    if (!value.trim() || value.trim().length > 120) {
      setError("Enter a staff name between 1 and 120 characters.");
      return false;
    }
    return true;
  }

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
          onChange={(event) => changeQuery(event.target.value)}
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
          onClick={() => void load(cursor)}
        >
          Load more staff
        </button>
      )}
      {retryFrom !== undefined && (
        <button
          className="button button-secondary"
          disabled={disabled}
          onClick={() => void load(retryFrom)}
        >
          Retry loading staff
        </button>
      )}
      <button
        className="button button-secondary"
        disabled={disabled}
        onClick={() => void load(null)}
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
