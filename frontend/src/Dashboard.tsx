import { useEffect, useRef, useState } from "react";
import type {
  Api,
  RequestCounts,
  RequestQueuePage,
  ServiceRequest,
  SupportStaff,
} from "./types";
import { errorMessage } from "./useSession";
import { StaffManagement } from "./StaffManagement";
import { RequestCard, staffLabel } from "./RequestCard";
import { CreateRequest } from "./CreateRequest";

const emptyCounts: RequestCounts = {
  total: 0,
  newCount: 0,
  inProgressCount: 0,
  resolvedCount: 0,
};
export function Dashboard({
  api,
  support,
  username,
  logout,
  onConnection,
}: {
  api: Api;
  support: boolean;
  username: string;
  logout: () => Promise<void>;
  onConnection: (connected: boolean) => void;
}) {
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [counts, setCounts] = useState(emptyCounts);
  const [staff, setStaff] = useState<SupportStaff[]>([]);
  const [query, setQuery] = useState("");
  const [staffFilter, setStaffFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState(false);
  const sequence = useRef(0);
  const revision = useRef(0);
  const alive = useRef(true);
  const abort = useRef<AbortController | null>(null);
  const active = useRef({ query: "", staffFilter: "" });
  async function load(append = false) {
    if (
      append &&
      (loading ||
        !cursor ||
        query !== active.current.query ||
        staffFilter !== active.current.staffFilter)
    )
      return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const id = ++sequence.current,
      version = revision.current;
    setLoading(true);
    setLoadError(false);
    try {
      const params = new URLSearchParams({ limit: "25", q: query.trim() });
      if (staffFilter === "unassigned") params.set("unassigned", "true");
      else if (staffFilter) params.set("staffId", staffFilter);
      if (append && cursor) params.set("cursor", cursor);
      const page = await api<RequestQueuePage>(`/api/requests?${params}`, {
        signal: controller.signal,
      });
      if (!alive.current || id !== sequence.current) return;
      // A response dispatched before a mutation must not restore old field values.
      if (version !== revision.current) {
        void load();
        return;
      }
      setRequests((previous) => [
        ...new Map(
          [...(append ? previous : []), ...page.items].map((item) => [
            item.id,
            item,
          ]),
        ).values(),
      ]);
      // Assignment identities remain selectable after unassignment, even outside the first staff page.
      setStaff((previous) => {
        const known = new Map(previous.map((person) => [person.id, person]));
        for (const item of page.items)
          if (item.assigneeId && !known.has(item.assigneeId))
            known.set(item.assigneeId, {
              id: item.assigneeId,
              name: item.assignee ?? "",
              active: item.assigneeActive === true,
            });
        return [...known.values()];
      });
      onConnection(true);
      setCounts(page.counts);
      setCursor(page.nextCursor);
      active.current = { query, staffFilter };
      setNotice("");
    } catch (error) {
      if (
        alive.current &&
        id === sequence.current &&
        !controller.signal.aborted
      ) {
        setNotice(`Could not load requests: ${errorMessage(error)}`);
        onConnection(false);
        setLoadError(true);
      }
    } finally {
      if (alive.current && id === sequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => {
      window.clearTimeout(timer);
      abort.current?.abort();
      sequence.current++;
    };
  }, [query, staffFilter]);
  useEffect(
    () => () => {
      alive.current = false;
      abort.current?.abort();
    },
    [],
  );
  const receiveStaff = (people: SupportStaff[], _replace: boolean) =>
    setStaff((previous) => [
      ...new Map(
        [...previous, ...people].map((person) => [person.id, person]),
      ).values(),
    ]);
  function staffSaved(person: SupportStaff) {
    revision.current++;
    receiveStaff([person], false);
    setRequests((previous) =>
      previous.map((item) =>
        item.assigneeId === person.id
          ? { ...item, assignee: person.name, assigneeActive: person.active }
          : item,
      ),
    );
  }
  function updated(before: ServiceRequest, fields: Partial<ServiceRequest>) {
    revision.current++;
    setRequests((previous) =>
      previous.map((item) =>
        item.id === before.id ? { ...item, ...fields } : item,
      ),
    );
    if (fields.status && fields.status !== before.status) {
      const key = (status: string) =>
        status === "NEW"
          ? "newCount"
          : status === "IN_PROGRESS"
            ? "inProgressCount"
            : "resolvedCount";
      setCounts((previous) => ({
        ...previous,
        [key(before.status)]: previous[key(before.status)] - 1,
        [key(fields.status!)]: previous[key(fields.status!)] + 1,
      }));
    }
  }
  const known = new Map(staff.map((person) => [person.id, person]));
  for (const request of requests)
    if (request.assigneeId && !known.has(request.assigneeId))
      known.set(request.assigneeId, {
        id: request.assigneeId,
        name: request.assignee ?? "",
        active: request.assigneeActive === true,
      });
  const visible = requests
    .filter((item) => !statusFilter || item.status === statusFilter)
    .filter(
      (item) =>
        `${item.title} ${item.description} ${item.id} ${item.assignee ?? ""}`
          .toLowerCase()
          .includes(active.current.query.trim().toLowerCase()) &&
        (!active.current.staffFilter ||
          (active.current.staffFilter === "unassigned"
            ? !item.assigneeId
            : item.assigneeId === active.current.staffFilter)),
    );
  return (
    <main id="dashboard" className="page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">
            {username} · {support ? "support" : "requester"}
          </p>
          <h1>Service requests</h1>
          <p className="page-subtitle">
            One place to keep track of incoming work.
          </p>
        </div>
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
        <button className="button button-secondary" onClick={() => void load()}>
          Refresh
        </button>
      </header>
      <section className="stats" aria-label="Request summary">
        {(
          [
            [
              "Total requests",
              counts.total,
              "total",
              "Requests visible to your account",
            ],
            ["New", counts.newCount, "new", "Waiting to start"],
            [
              "In progress",
              counts.inProgressCount,
              "progress",
              "Currently being handled",
            ],
            [
              "Resolved",
              counts.resolvedCount,
              "resolved",
              "Completed requests",
            ],
          ] as const
        ).map(([label, count, style, caption]) => (
          <article className={`stat-card stat-${style}`} key={style}>
            <span className="stat-label">{label}</span>
            <strong id={`${style}-count`} className="stat-number">
              {count}
            </strong>
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
                {query || staffFilter || statusFilter
                  ? `${visible.length} matching requests loaded`
                  : `Showing ${requests.length} of ${counts.total} requests`}
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
                onChange={(event) => {
                  sequence.current++;
                  setQuery(event.target.value);
                }}
              />
            </label>
            <label className="control-field">
              <span>Status (loaded requests)</span>
              <select
                className="control-select"
                aria-label="Filter loaded requests by status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="">All statuses</option>
                {["NEW", "IN_PROGRESS", "RESOLVED"].map((value) => (
                  <option key={value} value={value}>
                    {value.replace("_", " ")}
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
                  onChange={(event) => {
                    sequence.current++;
                    setStaffFilter(event.target.value);
                  }}
                >
                  <option value="">All staff</option>
                  <option value="unassigned">Unassigned</option>
                  {[...known.values()]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((person) => (
                      <option key={person.id} value={person.id}>
                        {staffLabel(person)}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </div>
          {notice && (
            <div id="notice" className="notice notice-info" role="status">
              {notice}
            </div>
          )}
          {loadError && (
            <button
              className="button button-secondary"
              onClick={() => void load()}
            >
              Retry loading requests
            </button>
          )}
          {loading && (
            <div className="loading-placeholder" role="status">
              Loading requests…
            </div>
          )}
          <div className="request-list">
            {visible.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                api={api}
                support={support}
                staff={[...known.values()]}
                onUpdated={updated}
                notify={setNotice}
              />
            ))}
          </div>
          {cursor && (
            <button
              className="button button-secondary"
              disabled={
                loading ||
                query !== active.current.query ||
                staffFilter !== active.current.staffFilter
              }
              onClick={() => void load(true)}
            >
              Load more requests
            </button>
          )}
          {!loading && !visible.length && (
            <div className="empty-state">
              <span className="empty-symbol" aria-hidden="true">
                ○
              </span>
              <h3>
                {query || staffFilter || statusFilter
                  ? "No matching requests"
                  : "No requests yet"}
              </h3>
              <p>
                {query || staffFilter || statusFilter
                  ? "Try another search term or staff filter."
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
            Add a request to the queue. Support manages status, priority and
            assignment.
          </p>
          <CreateRequest
            api={api}
            support={support}
            notify={setNotice}
            onCreated={(created) => {
              revision.current++;
              setRequests((previous) => [created, ...previous]);
              setCounts((previous) => ({
                ...previous,
                total: previous.total + 1,
                newCount: previous.newCount + 1,
              }));
            }}
          />
          {support && (
            <div id="staff-management-root">
              <StaffManagement
                api={api}
                onPage={receiveStaff}
                onSaved={staffSaved}
              />
            </div>
          )}
          <p className="form-note">
            Requests are saved in PostgreSQL and remain available after the app
            restarts.
          </p>
        </aside>
      </div>
      <footer className="page-footer">
        <span>Request Tracker</span>
        <span>Local development workspace</span>
      </footer>
    </main>
  );
}
