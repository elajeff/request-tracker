import { useCallback, useMemo, useState } from "react";
import type { Api, SupportStaff } from "./types";
import { useRequestQueue } from "./useRequestQueue";
import { StaffManagement } from "./StaffManagement";
import { AccountManagement } from "./AccountManagement";
import { RequestCard } from "./RequestCard";
import {
  errorMessage,
  label,
  requestStatuses,
  staffLabel,
  uniqueById,
} from "./helpers";
import { CreateRequest } from "./CreateRequest";

export function Dashboard({
  api,
  support,
  username,
  logout,
  onSessionEnded,
  onConnection,
}: {
  api: Api;
  support: boolean;
  username: string;
  logout: () => Promise<void>;
  onSessionEnded: () => void;
  onConnection: (connected: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [staffFilter, setStaffFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [directory, setDirectory] = useState<SupportStaff[]>([]);
  const [notice, setNotice] = useState("");
  const queue = useRequestQueue(
    api,
    { query, staff: staffFilter, status: statusFilter },
    onConnection,
  );
  // Directory records are fresher; assignees fill in people not loaded yet.
  const knownStaff = useMemo(
    () => uniqueById([...queue.assignees, ...directory]),
    [queue.assignees, directory],
  );
  const receiveStaff = useCallback(
    (people: SupportStaff[]) =>
      setDirectory((previous) => uniqueById([...previous, ...people])),
    [],
  );
  const filtered = Boolean(query || staffFilter || statusFilter);
  const message = queue.error || notice;
  return (
    <main className="page">
      <header className="page-heading">
        <h1>Service requests</h1>
        <div className="page-actions">
          <p className="signed-in">
            Signed in as <strong>{username}</strong>{" "}
            <span className="role-badge">
              {support ? "Support" : "Requester"}
            </span>
          </p>
          <button className="button button-secondary" onClick={queue.refresh}>
            Refresh
          </button>
          <button
            className="button button-secondary"
            onClick={() =>
              void logout().catch((error) =>
                setNotice(`Could not sign out: ${errorMessage(error)}`),
              )
            }
          >
            Sign out
          </button>
        </div>
      </header>
      <section className="stats" aria-label="Request summary">
        {(
          [
            [
              "Total requests",
              queue.counts.total,
              "total",
              "Requests visible to your account",
            ],
            ["New", queue.counts.newCount, "new", "Waiting to start"],
            [
              "In progress",
              queue.counts.inProgressCount,
              "progress",
              "Currently being handled",
            ],
            [
              "Resolved",
              queue.counts.resolvedCount,
              "resolved",
              "Completed requests",
            ],
          ] as const
        ).map(([title, count, style, caption]) => (
          <article className={`stat-card stat-${style}`} key={style}>
            <span className="stat-label">{title}</span>
            <strong className="stat-number">{count}</strong>
            <span className="stat-caption">{caption}</span>
          </article>
        ))}
      </section>
      <div className="workspace">
        <section className="panel queue-panel" aria-labelledby="queue-heading">
          <div className="panel-header">
            <div>
              <h2 id="queue-heading">Request queue</h2>
              <p className="muted">
                {filtered
                  ? `${queue.requests.length} matching requests loaded`
                  : `Showing ${queue.requests.length} of ${queue.counts.total} requests`}
              </p>
            </div>
            <label className="search-field">
              <span className="visually-hidden">Search requests</span>
              <span className="search-symbol" aria-hidden="true">
                ⌕
              </span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label className="control-field">
              <span>Status</span>
              <select
                className="control-select"
                aria-label="Filter by status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="">All statuses</option>
                {requestStatuses.map((value) => (
                  <option key={value} value={value}>
                    {label(value)}
                  </option>
                ))}
              </select>
            </label>
            {support && (
              <label className="control-field">
                <span>Assigned staff</span>
                <select
                  className="control-select"
                  aria-label="Filter by assigned staff"
                  value={staffFilter}
                  onChange={(event) => setStaffFilter(event.target.value)}
                >
                  <option value="">All staff</option>
                  <option value="unassigned">Unassigned</option>
                  {[...knownStaff]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((person) => (
                      <option key={person.id} value={person.id}>
                        {staffLabel(person, knownStaff)}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </div>
          {message && (
            <div id="notice" className="notice" role="status">
              {message}
            </div>
          )}
          {queue.error && (
            <button className="button button-secondary" onClick={queue.refresh}>
              Retry loading requests
            </button>
          )}
          {queue.loading && (
            <div className="loading-placeholder" role="status">
              Loading requests…
            </div>
          )}
          <div className="request-list">
            {queue.requests.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                api={api}
                support={support}
                staff={knownStaff}
                onUpdated={queue.edited}
                notify={setNotice}
              />
            ))}
          </div>
          {queue.hasMore && (
            <button
              className="button button-secondary"
              disabled={!queue.canLoadMore}
              onClick={queue.loadMore}
            >
              Load more requests
            </button>
          )}
          {!queue.loading && !queue.requests.length && (
            <div className="empty-state">
              <span className="empty-symbol" aria-hidden="true">
                ○
              </span>
              <h3>
                {filtered ? "No matching requests" : "No requests yet"}
              </h3>
              <p>
                {filtered
                  ? "Try a different search or filter."
                  : "Create your first request using the form."}
              </p>
            </div>
          )}
        </section>
        <aside className="panel create-panel" aria-labelledby="create-heading">
          <div className="create-icon" aria-hidden="true">
            +
          </div>
          <h2 id="create-heading">Create request</h2>
          <p className="muted create-intro">
            Describe the problem and support will pick it up.
          </p>
          <CreateRequest
            api={api}
            support={support}
            notify={setNotice}
            onCreated={queue.created}
          />
          {support && (
            <div id="staff-management-root">
              <StaffManagement
                api={api}
                onPage={receiveStaff}
                onSaved={(person) => {
                  setDirectory((previous) => uniqueById([...previous, person]));
                  queue.staffChanged(person);
                }}
              />
              <AccountManagement
                api={api}
                username={username}
                onOwnSessionEnded={onSessionEnded}
              />
            </div>
          )}
        </aside>
      </div>
      <footer className="page-footer">
        <span>Request Tracker</span>
      </footer>
    </main>
  );
}
