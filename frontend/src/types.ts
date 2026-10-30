export type RequestStatus = "NEW" | "IN_PROGRESS" | "RESOLVED";
export type RequestPriority = "LOW" | "MEDIUM" | "HIGH";

export interface ServiceRequest {
  id: string;
  title: string;
  description: string;
  status: RequestStatus;
  priority: RequestPriority;
  createdAt: string;
  assignee: string | null;
  assigneeId: string | null;
  assigneeActive: boolean | null;
}

export interface RequestHistoryEntry {
  id: number;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changedAt: string;
  actorUsername: string | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface RequestCounts {
  total: number;
  newCount: number;
  inProgressCount: number;
  resolvedCount: number;
}

export interface RequestQueuePage extends Page<ServiceRequest> {
  counts: RequestCounts;
}

export interface SupportStaff {
  id: string;
  name: string;
  active: boolean;
}
export type Api = <T>(path: string, options?: RequestInit) => Promise<T>;
export interface SessionView {
  user: { id: string; username: string; role: "REQUESTER" | "SUPPORT" } | null;
  csrfToken: string;
  csrfHeaderName: string;
}
