import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Api,
  RequestCounts,
  RequestQueuePage,
  RequestStatus,
  ServiceRequest,
  SupportStaff,
} from "./types";
import { errorMessage, uniqueById } from "./helpers";

export interface QueueFilters {
  query: string;
  /** A staff ID, "unassigned", or "" for everyone. */
  staff: string;
  status: string;
}

const emptyCounts: RequestCounts = {
  total: 0,
  newCount: 0,
  inProgressCount: 0,
  resolvedCount: 0,
};

const countKey = {
  NEW: "newCount",
  IN_PROGRESS: "inProgressCount",
  RESOLVED: "resolvedCount",
} as const satisfies Record<RequestStatus, keyof RequestCounts>;

const sameFilters = (a: QueueFilters | null, b: QueueFilters) =>
  a !== null &&
  a.query === b.query &&
  a.staff === b.staff &&
  a.status === b.status;

function queuePath(filters: QueueFilters, cursor: string | null) {
  const params = new URLSearchParams({ limit: "25", q: filters.query.trim() });
  if (filters.staff === "unassigned") params.set("unassigned", "true");
  else if (filters.staff) params.set("staffId", filters.staff);
  if (filters.status) params.set("status", filters.status);
  if (cursor) params.set("cursor", cursor);
  return `/api/requests?${params}`;
}

/**
 * Loads the request queue for the given filters, 250 ms after they stop changing.
 * Changing the filters or unmounting aborts the request in flight, so a slow old
 * response can never replace a newer one.
 */
export function useRequestQueue(
  api: Api,
  { query, staff, status }: QueueFilters,
  onConnection: (connected: boolean) => void,
) {
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [counts, setCounts] = useState(emptyCounts);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadedFilters, setLoadedFilters] = useState<QueueFilters | null>(
    null,
  );
  // The first page loads on mount, so start in the loading state rather than showing "No requests yet".
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Everyone seen as an assignee, kept after unassignment so they stay
  // selectable even when they are not on the loaded staff page.
  const [assignees, setAssignees] = useState<SupportStaff[]>([]);
  const inFlight = useRef<AbortController | null>(null);
  // Bumped on every local edit. A page requested before an edit is discarded
  // and fetched again, so it cannot put old field values back.
  const revision = useRef(0);
  const latestFilters = useRef<QueueFilters>({ query, staff, status });

  const fetchPage = useCallback(
    async (filters: QueueFilters, after: string | null) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      setLoading(true);
      setError("");
      try {
        const load = (cursor: string | null) =>
          api<RequestQueuePage>(queuePath(filters, cursor), {
            signal: controller.signal,
          });
        let startedAt = revision.current;
        let page = await load(after);
        // Fetch the same page again if the user edited something meanwhile.
        while (!controller.signal.aborted && startedAt !== revision.current) {
          startedAt = revision.current;
          page = await load(after);
        }
        if (controller.signal.aborted) return;
        setRequests((previous) =>
          uniqueById(after ? [...previous, ...page.items] : page.items),
        );
        setCounts(page.counts);
        setCursor(page.nextCursor);
        setLoadedFilters(filters);
        setAssignees((previous) =>
          uniqueById([
            ...previous,
            ...page.items.flatMap((item) =>
              item.assigneeId
                ? [
                    {
                      id: item.assigneeId,
                      name: item.assignee ?? "",
                      active: item.assigneeActive === true,
                    },
                  ]
                : [],
            ),
          ]),
        );
        onConnection(true);
      } catch (failure) {
        if (controller.signal.aborted) return;
        setError(`Could not load requests: ${errorMessage(failure)}`);
        onConnection(false);
      } finally {
        if (inFlight.current === controller) setLoading(false);
      }
    },
    [api, onConnection],
  );

  // Only the dashboard reports failures, so clear the status when it goes away.
  useEffect(() => () => onConnection(true), [onConnection]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => void fetchPage({ query, staff, status }, null),
      250,
    );
    return () => {
      window.clearTimeout(timer);
      inFlight.current?.abort();
    };
  }, [fetchPage, query, staff, status]);

  const current = { query, staff, status };
  useEffect(() => {
    latestFilters.current = current;
  });
  const upToDate = sameFilters(loadedFilters, current);

  return {
    requests,
    assignees,
    counts,
    loading,
    error,
    hasMore: cursor !== null,
    canLoadMore: cursor !== null && !loading && upToDate,
    refresh: () => void fetchPage(current, null),
    loadMore: () => void fetchPage(current, cursor),
    edited(before: ServiceRequest, fields: Partial<ServiceRequest>) {
      revision.current++;
      // The card stays put until the list reloads, so it doesn't vanish while being worked on.
      setRequests((previous) =>
        previous.map((item) =>
          item.id === before.id ? { ...item, ...fields } : item,
        ),
      );
      const after = fields.status;
      if (after && after !== before.status) {
        setCounts((previous) => ({
          ...previous,
          [countKey[before.status]]: previous[countKey[before.status]] - 1,
          [countKey[after]]: previous[countKey[after]] + 1,
        }));
      }
    },
    created(item: ServiceRequest) {
      revision.current++;
      const filters = latestFilters.current;
      if (filters.query || filters.staff || filters.status) {
        // A new request may not match the filters, and the server decides that.
        void fetchPage(filters, null);
        return;
      }
      setRequests((previous) => [item, ...previous]);
      setCounts((previous) => ({
        ...previous,
        total: previous.total + 1,
        newCount: previous.newCount + 1,
      }));
    },
    staffChanged(person: SupportStaff) {
      revision.current++;
      setAssignees((previous) =>
        previous.map((known) => (known.id === person.id ? person : known)),
      );
      setRequests((previous) =>
        previous.map((item) =>
          item.assigneeId === person.id
            ? { ...item, assignee: person.name, assigneeActive: person.active }
            : item,
        ),
      );
    },
  };
}
