import { useEffect, useRef, useState } from "react";
import type { Api, ServiceRequest, SupportStaff } from "./types";
import {
  errorMessage,
  label,
  requestPriorities,
  staffLabel,
} from "./helpers";
import { History } from "./History";

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
  const [statusChoice, setStatusChoice] = useState<string | null>(null);
  const [priorityChoice, setPriorityChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const focusBack = useRef<
    "status" | "details" | "priority" | "assignment" | null
  >(null);
  const statusSelect = useRef<HTMLSelectElement>(null);
  const statusButton = useRef<HTMLButtonElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const saveDetailsButton = useRef<HTMLButtonElement>(null);
  const prioritySelect = useRef<HTMLSelectElement>(null);
  const priorityButton = useRef<HTMLButtonElement>(null);
  const assignmentSelect = useRef<HTMLSelectElement>(null);
  const assignmentButton = useRef<HTMLButtonElement>(null);
  // The Save status button can unmount and the select can stay disabled during
  // a save, and the details form unmounts on Save and Cancel. The Save
  // priority and Save assignment buttons are disabled during their saves.
  // Each drops focus to the page. Put it back only if that happened. After a
  // failed details save the form is still open, so focus goes to its Save
  // changes button. After a failed priority or assignment save focus goes
  // back to the button. After one that worked, Save priority is gone and
  // Save assignment is disabled, so focus goes to the select.
  useEffect(() => {
    if (busy || !focusBack.current) return;
    const restore = focusBack.current;
    focusBack.current = null;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    if (restore === "details") {
      (editButton.current ?? saveDetailsButton.current)?.focus();
      return;
    }
    if (restore === "priority") {
      (priorityButton.current ?? prioritySelect.current)?.focus();
      return;
    }
    if (restore === "assignment") {
      (assignmentButton.current?.disabled
        ? assignmentSelect
        : assignmentButton
      ).current?.focus();
      return;
    }
    const target = statusButton.current ?? statusSelect.current;
    (target && !target.disabled ? target : editButton.current)?.focus();
  }, [busy, draft]);
  // Drop a pending choice if that person was deactivated before it was saved.
  const pending =
    assignment !== null &&
    assignment !== request.assigneeId &&
    staff.some((person) => person.id === assignment && !person.active)
      ? null
      : assignment;
  async function save(
    focus: "status" | "details" | "priority" | "assignment",
    path: string,
    method: string,
    body: object,
    fields: (updated: ServiceRequest) => Partial<ServiceRequest>,
    message: string,
    reset: () => void,
  ) {
    if (lock.current) return;
    lock.current = true;
    focusBack.current = focus;
    setBusy(true);
    try {
      const updated = await api<ServiceRequest>(
        `/api/requests/${request.id}${path}`,
        { method, body: JSON.stringify(body) },
      );
      onUpdated(request, fields(updated));
      reset();
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
      person.id === pending,
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
  // Arrow keys on a closed select fire change on Windows, and status only
  // moves forward, so the choice is saved with a button. A choice left over
  // from an older status is no longer offered and is ignored.
  const pendingStatus =
    statusChoice !== null &&
    statusChoice !== request.status &&
    statuses.includes(statusChoice)
      ? statusChoice
      : null;
  const pendingPriority =
    priorityChoice !== request.priority ? priorityChoice : null;
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
            {label(request.status)}
          </span>
          <span className={`pill priority-${request.priority.toLowerCase()}`}>
            {label(request.priority)}
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
        <span>Assigned staff: {request.assignee ?? "Unassigned"}</span>
      </div>
      {!draft && (support || request.status === "NEW") && (
        <button
          ref={editButton}
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
              "details",
              "",
              "PUT",
              {
                title: draft.title.trim(),
                description: draft.description.trim(),
              },
              (item) => ({ title: item.title, description: item.description }),
              "Request details updated.",
              () => setDraft(null),
            );
          }}
        >
          <label className="form-field">
            <span>Title</span>
            <input
              autoFocus
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
            <button
              ref={saveDetailsButton}
              className="button button-primary"
              disabled={busy}
            >
              Save changes
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => {
                focusBack.current = "details";
                setDraft(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {support && (
        <>
          <div className="request-controls">
            <div className="control-group">
              <label className="control-field">
                <span>Status</span>
                <select
                  ref={statusSelect}
                  className="control-select"
                  aria-label={`Status for ${request.title}`}
                  value={pendingStatus ?? request.status}
                  disabled={busy || request.status === "RESOLVED"}
                  onChange={(event) => setStatusChoice(event.target.value)}
                >
                  {statuses.map((value) => (
                    <option key={value} value={value}>
                      {label(value)}
                    </option>
                  ))}
                </select>
              </label>
              {pendingStatus && (
                <button
                  ref={statusButton}
                  className="button button-secondary control-save"
                  aria-label={`Save status for ${request.title}`}
                  disabled={busy}
                  onClick={() =>
                    void save(
                      "status",
                      "/status",
                      "PATCH",
                      { status: pendingStatus },
                      (item) => ({ status: item.status }),
                      "Status updated.",
                      () => setStatusChoice(null),
                    )
                  }
                >
                  Save status
                </button>
              )}
            </div>
            <div className="control-group">
              <label className="control-field">
                <span>Priority</span>
                <select
                  ref={prioritySelect}
                  className="control-select"
                  aria-label={`Priority for ${request.title}`}
                  value={pendingPriority ?? request.priority}
                  disabled={busy}
                  onChange={(event) => setPriorityChoice(event.target.value)}
                >
                  {requestPriorities.map((value) => (
                    <option key={value} value={value}>
                      {label(value)}
                    </option>
                  ))}
                </select>
              </label>
              {pendingPriority && (
                <button
                  ref={priorityButton}
                  className="button button-secondary control-save"
                  aria-label={`Save priority for ${request.title}`}
                  disabled={busy}
                  onClick={() =>
                    void save(
                      "priority",
                      "/priority",
                      "PATCH",
                      { priority: pendingPriority },
                      (item) => ({ priority: item.priority }),
                      "Priority updated.",
                      () => setPriorityChoice(null),
                    )
                  }
                >
                  Save priority
                </button>
              )}
            </div>
          </div>
          <form
            className="assignment-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save(
                "assignment",
                "/assignment",
                "PATCH",
                pending ? { staffId: pending } : { unassign: true },
                (item) => ({
                  assignee: item.assignee,
                  assigneeId: item.assigneeId,
                  assigneeActive: item.assigneeActive,
                }),
                "Assignment updated.",
                () => setAssignment(null),
              );
            }}
          >
            <label className="form-field">
              <span>Assigned support staff</span>
              <select
                ref={assignmentSelect}
                className="control-select assignment-select"
                aria-label={`Assigned staff for ${request.title}`}
                value={pending ?? request.assigneeId ?? ""}
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
                      {staffLabel(person, choices)}
                    </option>
                  ))}
              </select>
            </label>
            <button
              ref={assignmentButton}
              className="button button-secondary"
              disabled={
                busy ||
                pending === null ||
                pending === (request.assigneeId ?? "")
              }
            >
              Save assignment
            </button>
            <small>
              More staff are listed under Manage support staff.
            </small>
          </form>
        </>
      )}
      <History request={request} api={api} />
    </article>
  );
}
