import { useEffect, useRef, useState } from "react";
import type {
  Api,
  Page,
  RequestHistoryEntry,
  ServiceRequest,
  SupportStaff,
} from "./types";
import { errorMessage } from "./useSession";

export const statusLabel = (status: string) =>
  status === "IN_PROGRESS"
    ? "In progress"
    : status[0] + status.slice(1).toLowerCase();
export const staffLabel = (person: SupportStaff) =>
  `${person.name || "(blank legacy name)"} [${person.id}]${person.active ? "" : " — inactive"}`;

function History({ request, api }: { request: ServiceRequest; api: Api }) {
  const [entries, setEntries] = useState<RequestHistoryEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
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
      if (!alive.current) return;
      setEntries((previous) => [
        ...new Map(
          [...(append ? previous : []), ...page.items].map((item) => [
            item.id,
            item,
          ]),
        ).values(),
      ]);
      setCursor(page.nextCursor);
      setLoaded(true);
    } catch (failure) {
      if (alive.current)
        setError(`Could not load history: ${errorMessage(failure)}`);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <details
      className="request-history"
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
                : `${entry.oldValue ?? "Unassigned"} → ${entry.newValue ?? "Unassigned"}`}
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

export function RequestCard({
  request,
  api,
  support,
  staff,
  onUpdated,
  notify,
}: {
  request: ServiceRequest;
  api: Api;
  support: boolean;
  staff: SupportStaff[];
  onUpdated: (request: ServiceRequest, fields: Partial<ServiceRequest>) => void;
  notify: (message: string) => void;
}) {
  const [draft, setDraft] = useState<{
    title: string;
    description: string;
  } | null>(null);
  const [assignment, setAssignment] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const titleInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (draft) titleInput.current?.focus();
  }, [draft !== null]);
  useEffect(() => {
    if (
      assignment &&
      staff.some((person) => person.id === assignment && !person.active) &&
      request.assigneeId !== assignment
    )
      setAssignment(null);
  }, [staff, assignment, request.assigneeId]);
  async function save(
    path: string,
    method: string,
    body: object,
    fields: (updated: ServiceRequest) => Partial<ServiceRequest>,
    message: string,
  ) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const updated = await api<ServiceRequest>(
        `/api/requests/${request.id}${path}`,
        { method, body: JSON.stringify(body) },
      );
      onUpdated(request, fields(updated));
      if (!path) setDraft(null);
      if (path === "/assignment") setAssignment(null);
      notify(message);
    } catch (error) {
      notify(`Could not update request: ${errorMessage(error)}`);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const choices = staff.filter(
    (person) =>
      person.active ||
      person.id === request.assigneeId ||
      person.id === assignment,
  );
  if (
    request.assigneeId &&
    !choices.some((person) => person.id === request.assigneeId)
  )
    choices.push({
      id: request.assigneeId,
      name: request.assignee ?? "",
      active: request.assigneeActive === true,
    });
  const statuses =
    request.status === "NEW"
      ? ["NEW", "IN_PROGRESS"]
      : request.status === "IN_PROGRESS"
        ? ["IN_PROGRESS", "RESOLVED"]
        : ["RESOLVED"];
  return (
    <article
      className="request-card"
      data-request-id={request.id}
      aria-labelledby={`request-title-${request.id}`}
    >
      <div className="request-heading-row">
        <div className="request-title-block">
          <h3 className="request-title" id={`request-title-${request.id}`}>
            {request.title}
          </h3>
          <span className="request-id">
            #{request.id.slice(0, 8).toUpperCase()}
          </span>
        </div>
        <div className="request-badges">
          <span
            className={`pill status-${request.status.toLowerCase().replace("_", "-")}`}
          >
            {statusLabel(request.status)}
          </span>
          <span className={`pill priority-${request.priority.toLowerCase()}`}>
            {request.priority}
          </span>
        </div>
      </div>
      <p className="request-description">{request.description}</p>
      <div className="request-meta">
        <span>
          Created{" "}
          {new Date(request.createdAt).toLocaleDateString(undefined, {
            dateStyle: "medium",
          })}
        </span>
        <span>{request.id}</span>
      </div>
      {!draft && (support || request.status === "NEW") && (
        <button
          className="button button-secondary request-edit-button"
          aria-label={`Edit details for ${request.title}`}
          onClick={() =>
            setDraft({ title: request.title, description: request.description })
          }
        >
          Edit details
        </button>
      )}
      {draft && (support || request.status === "NEW") && (
        <form
          className="request-edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.title.trim() || !draft.description.trim()) {
              notify("Enter both a title and a description.");
              return;
            }
            void save(
              "",
              "PUT",
              {
                title: draft.title.trim(),
                description: draft.description.trim(),
              },
              (item) => ({ title: item.title, description: item.description }),
              "Request details updated.",
            );
          }}
        >
          <label className="form-field">
            <span>Title</span>
            <input
              ref={titleInput}
              required
              maxLength={120}
              value={draft.title}
              onChange={(event) =>
                setDraft({ ...draft, title: event.target.value })
              }
            />
          </label>
          <label className="form-field">
            <span>Description</span>
            <textarea
              required
              rows={3}
              maxLength={2000}
              value={draft.description}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
            />
          </label>
          <div className="edit-actions">
            <button className="button button-primary" disabled={busy}>
              Save changes
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {support && (
        <>
          <div className="request-controls">
            <label className="control-field">
              <span>Status</span>
              <select
                className="control-select"
                aria-label={`Status for ${request.title}`}
                value={request.status}
                disabled={busy || request.status === "RESOLVED"}
                onChange={(event) =>
                  void save(
                    "/status",
                    "PATCH",
                    { status: event.target.value },
                    (item) => ({ status: item.status }),
                    `Status updated.`,
                  )
                }
              >
                {statuses.map((value) => (
                  <option key={value} value={value}>
                    {statusLabel(value)}
                  </option>
                ))}
              </select>
            </label>
            <label className="control-field">
              <span>Priority</span>
              <select
                className="control-select"
                aria-label={`Priority for ${request.title}`}
                value={request.priority}
                disabled={busy}
                onChange={(event) =>
                  void save(
                    "/priority",
                    "PATCH",
                    { priority: event.target.value },
                    (item) => ({ priority: item.priority }),
                    "Priority updated.",
                  )
                }
              >
                {["HIGH", "MEDIUM", "LOW"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          </div>
          <form
            className="assignment-form"
            onSubmit={(event) => {
              event.preventDefault();
              const id = assignment ?? request.assigneeId;
              void save(
                "/assignment",
                "PATCH",
                id ? { staffId: id } : { unassign: true },
                (item) => ({
                  assignee: item.assignee,
                  assigneeId: item.assigneeId,
                  assigneeActive: item.assigneeActive,
                }),
                "Assignment updated.",
              );
            }}
          >
            <label className="form-field">
              <span>Assigned support staff</span>
              <select
                className="control-select assignment-select"
                aria-label={`Assigned staff for ${request.title}`}
                value={assignment ?? request.assigneeId ?? ""}
                disabled={busy}
                onChange={(event) => setAssignment(event.target.value)}
              >
                <option value="">Unassigned</option>
                {choices
                  .sort(
                    (a, b) =>
                      a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
                  )
                  .map((person) => (
                    <option
                      key={person.id}
                      value={person.id}
                      disabled={!person.active}
                    >
                      {staffLabel(person)}
                    </option>
                  ))}
              </select>
            </label>
            <button className="button button-secondary" disabled={busy}>
              Save assignment
            </button>
            <small>
              Choose Unassigned to clear. More staff are available under Manage
              support staff.
            </small>
          </form>
        </>
      )}
      <p>Assigned staff: {request.assignee ?? "Unassigned"}</p>
      <History request={request} api={api} />
    </article>
  );
}
