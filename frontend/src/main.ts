import "./style.css";

type RequestStatus = "NEW" | "IN_PROGRESS" | "RESOLVED";
type RequestPriority = "LOW" | "MEDIUM" | "HIGH";

interface ServiceRequest {
  id: string;
  title: string;
  description: string;
  status: RequestStatus;
  priority: RequestPriority;
  createdAt: string;
  assignee: string | null;
}

interface RequestHistoryEntry {
  id: number;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changedAt: string;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

interface RequestCounts {
  total: number;
  newCount: number;
  inProgressCount: number;
  resolvedCount: number;
}

interface RequestQueuePage extends Page<ServiceRequest> {
  counts: RequestCounts;
}

const assignmentDrafts = new Map<string, string>();

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing page element: ${id}`);
  return element as T;
};

const requestList = $("request-list");
const searchInput = $("search-input") as HTMLInputElement;
const notice = $("notice");
const loadingPlaceholder = $("loading-placeholder");
const emptyState = $("empty-state");
const createForm = $("create-form") as HTMLFormElement;
const titleInput = $("title-input") as HTMLInputElement;
const descriptionInput = $("description-input") as HTMLTextAreaElement;
const priorityInput = $("create-priority") as HTMLSelectElement;
const createButton = $("create-button") as HTMLButtonElement;
const connectionIndicator = $("connection-indicator");
const apiStatus = $("api-status");
const loadMoreButton = $("load-more-button") as HTMLButtonElement;

let requests: ServiceRequest[] = [];
let loadSequence = 0;
let dataRevision = 0;
let nextCursor: string | null = null;
let activeQuery = "";
let requestsLoading = false;
let searchTimer: number | undefined;
let counts: RequestCounts = { total: 0, newCount: 0, inProgressCount: 0, resolvedCount: 0 };
const drafts = new Map<string, { title: string; description: string }>();

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, { ...options, headers });
  const text = await response.text();

  if (!response.ok) {
    let message = text || `${response.status} ${response.statusText}`;

    try {
      const body = JSON.parse(text) as {
        detail?: unknown;
        message?: unknown;
        title?: unknown;
      };
      const detail = body.detail ?? body.message ?? body.title;
      if (typeof detail === "string") message = detail;
    } catch {
      // Use the response text when the server did not return JSON.
    }

    throw new Error(message);
  }

  return (text ? JSON.parse(text) : undefined) as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

function showNotice(
  message: string,
  kind: "success" | "error" | "info" = "info"
): void {
  notice.textContent = message;
  notice.className = `notice notice-${kind}`;
  notice.hidden = !message;
}

function setConnectionStatus(connected: boolean): void {
  connectionIndicator.classList.toggle("connected", connected);
  connectionIndicator.classList.toggle("disconnected", !connected);
  apiStatus.textContent = connected ? "API connected" : "API unavailable";
}

function statusLabel(status: RequestStatus): string {
  switch (status) {
    case "NEW":
      return "New";
    case "IN_PROGRESS":
      return "In progress";
    case "RESOLVED":
      return "Resolved";
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium"
  }).format(date);
}

function makeSelect<T extends string>(
  labelText: string,
  ariaLabel: string,
  options: readonly T[],
  selected: T
): { field: HTMLLabelElement; select: HTMLSelectElement } {
  const field = document.createElement("label");
  field.className = "control-field";

  const label = document.createElement("span");
  label.textContent = labelText;

  const select = document.createElement("select");
  select.className = "control-select";
  select.setAttribute("aria-label", ariaLabel);

  for (const value of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value === "IN_PROGRESS"
      ? "In progress"
      : value.charAt(0) + value.slice(1).toLowerCase();
    select.append(option);
  }

  select.value = selected;
  field.append(label, select);

  return { field, select };
}

function statusOptions(status: RequestStatus): RequestStatus[] {
  switch (status) {
    case "NEW":
      return ["NEW", "IN_PROGRESS"];
    case "IN_PROGRESS":
      return ["IN_PROGRESS", "RESOLVED"];
    case "RESOLVED":
      return ["RESOLVED"];
  }
}

function createRequestCard(request: ServiceRequest): HTMLElement {
  const card = document.createElement("article");
  card.className = "request-card";
  card.dataset.requestId = request.id;

  const headingRow = document.createElement("div");
  headingRow.className = "request-heading-row";

  const titleBlock = document.createElement("div");
  titleBlock.className = "request-title-block";

  const title = document.createElement("h3");
  title.className = "request-title";
  title.textContent = request.title;

  const id = document.createElement("span");
  id.className = "request-id";
  id.textContent = `#${request.id.slice(0, 8).toUpperCase()}`;

  titleBlock.append(title, id);

  const badges = document.createElement("div");
  badges.className = "request-badges";

  const statusBadge = document.createElement("span");
  statusBadge.className = `pill status-${request.status.toLowerCase().replace("_", "-")}`;
  statusBadge.textContent = statusLabel(request.status);

  const priorityBadge = document.createElement("span");
  priorityBadge.className = `pill priority-${request.priority.toLowerCase()}`;
  priorityBadge.textContent = request.priority;

  badges.append(statusBadge, priorityBadge);
  headingRow.append(titleBlock, badges);

  const description = document.createElement("p");
  description.className = "request-description";
  description.textContent = request.description;

  const meta = document.createElement("div");
  meta.className = "request-meta";

  const created = document.createElement("span");
  created.textContent = `Created ${formatDate(request.createdAt)}`;

  const fullId = document.createElement("span");
  fullId.textContent = request.id;

  meta.append(created, fullId);

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "button button-secondary request-edit-button";
  editButton.textContent = "Edit details";
  editButton.setAttribute("aria-label", `Edit details for ${request.title}`);

  const editForm = document.createElement("form");
  editForm.className = "request-edit-form";
  editForm.hidden = !drafts.has(request.id);

  const editTitleField = document.createElement("label");
  editTitleField.className = "form-field";
  const editTitleLabel = document.createElement("span");
  editTitleLabel.textContent = "Title";
  const editTitle = document.createElement("input");
  editTitle.type = "text";
  editTitle.maxLength = 120;
  editTitle.required = true;
  editTitle.value = drafts.get(request.id)?.title ?? request.title;
  editTitleField.append(editTitleLabel, editTitle);

  const editDescriptionField = document.createElement("label");
  editDescriptionField.className = "form-field";
  const editDescriptionLabel = document.createElement("span");
  editDescriptionLabel.textContent = "Description";
  const editDescription = document.createElement("textarea");
  editDescription.rows = 3;
  editDescription.maxLength = 2000;
  editDescription.required = true;
  editDescription.value = drafts.get(request.id)?.description ?? request.description;
  editDescriptionField.append(editDescriptionLabel, editDescription);

  const editActions = document.createElement("div");
  editActions.className = "edit-actions";

  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.className = "button button-primary";
  saveButton.textContent = "Save changes";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "button button-secondary";
  cancelButton.textContent = "Cancel";

  editActions.append(saveButton, cancelButton);
  editForm.append(editTitleField, editDescriptionField, editActions);

  editButton.hidden = !editForm.hidden;
  const saveDraft = () => {
    drafts.set(request.id, { title: editTitle.value, description: editDescription.value });
  };
  editTitle.addEventListener("input", saveDraft);
  editDescription.addEventListener("input", saveDraft);

  editButton.addEventListener("click", () => {
    editTitle.value = request.title;
    editDescription.value = request.description;
    saveDraft();
    editForm.hidden = false;
    editButton.hidden = true;
    editTitle.focus();
  });

  cancelButton.addEventListener("click", () => {
    drafts.delete(request.id);
    editForm.reset();
    editForm.hidden = true;
    editButton.hidden = false;
  });

  editForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const title = editTitle.value.trim();
    const description = editDescription.value.trim();

    if (!title || !description) {
      showNotice("Enter both a title and a description.", "error");
      return;
    }

    saveButton.disabled = true;
    saveButton.textContent = "Saving…";

    try {
      const updated = await api<ServiceRequest>(
        `/api/requests/${request.id}`,
        {
          method: "PUT",
          body: JSON.stringify({ title, description })
        }
      );

      drafts.delete(request.id);
      dataRevision++;
      requests = requests.map((item) => item.id === updated.id
        ? { ...item, title: updated.title, description: updated.description } : item);
      renderRequests();
      showNotice("Request details updated.", "success");
    } catch (error) {
      showNotice(`Could not update request: ${errorMessage(error)}`, "error");
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = "Save changes";
    }
  });

  const controls = document.createElement("div");
  controls.className = "request-controls";

  const statusControl = makeSelect(
    "Status",
    `Status for ${request.title}`,
    statusOptions(request.status),
    request.status
  );

  const priorityControl = makeSelect(
    "Priority",
    `Priority for ${request.title}`,
    ["HIGH", "MEDIUM", "LOW"] as const,
    request.priority
  );

  if (request.status === "RESOLVED") {
    statusControl.select.disabled = true;
  }

  statusControl.select.addEventListener("change", async () => {
    statusControl.select.disabled = true;

    try {
      const updated = await api<ServiceRequest>(
        `/api/requests/${request.id}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({
            status: statusControl.select.value
          })
        }
      );

      dataRevision++;
      const countKey = (status: RequestStatus): keyof RequestCounts =>
        status === "NEW" ? "newCount" : status === "IN_PROGRESS" ? "inProgressCount" : "resolvedCount";
      counts[countKey(request.status)]--;
      counts[countKey(updated.status)]++;
      requests = requests.map((item) => item.id === updated.id
        ? { ...item, status: updated.status } : item);
      renderRequests();
      showNotice(`Status updated to ${statusLabel(updated.status)}.`, "success");
    } catch (error) {
      showNotice(`Status update failed: ${errorMessage(error)}`, "error");
      await loadRequests();
    }
  });

  priorityControl.select.addEventListener("change", async () => {
    priorityControl.select.disabled = true;

    try {
      const updated = await api<ServiceRequest>(
        `/api/requests/${request.id}/priority`,
        {
          method: "PATCH",
          body: JSON.stringify({
            priority: priorityControl.select.value
          })
        }
      );

      dataRevision++;
      requests = requests.map((item) => item.id === updated.id
        ? { ...item, priority: updated.priority } : item);
      renderRequests();
      showNotice("Priority updated.", "success");
    } catch (error) {
      showNotice(`Priority update failed: ${errorMessage(error)}`, "error");
      await loadRequests();
    }
  });

  const assignmentForm = document.createElement("form");
  assignmentForm.className = "assignment-form";
  const assignmentField = document.createElement("label");
  assignmentField.className = "form-field";
  const assignmentLabel = document.createElement("span");
  assignmentLabel.textContent = "Assigned support staff";
  const assignee = document.createElement("input");
  assignee.type = "text";
  assignee.maxLength = 120;
  assignee.placeholder = "Unassigned";
  assignee.value = assignmentDrafts.get(request.id) ?? request.assignee ?? "";
  assignee.addEventListener("input", () => assignmentDrafts.set(request.id, assignee.value));
  assignmentField.append(assignmentLabel, assignee);
  const assignButton = document.createElement("button");
  assignButton.type = "submit";
  assignButton.className = "button button-secondary";
  assignButton.textContent = "Save assignment";
  const assignmentHelp = document.createElement("small");
  assignmentHelp.textContent = "Leave blank to unassign.";
  assignmentForm.append(assignmentField, assignButton, assignmentHelp);
  assignmentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    assignButton.disabled = true;
    try {
      const updated = await api<ServiceRequest>(`/api/requests/${request.id}/assignment`, {
        method: "PATCH", body: JSON.stringify({ assignee: assignee.value.trim() })
      });
      assignmentDrafts.delete(request.id);
      dataRevision++;
      requests = requests.map((item) => item.id === updated.id
        ? { ...item, assignee: updated.assignee } : item);
      renderRequests();
      showNotice("Assignment updated.", "success");
    } catch (error) {
      showNotice(`Assignment update failed: ${errorMessage(error)}`, "error");
    } finally {
      assignButton.disabled = false;
    }
  });

  const history = document.createElement("details");
  history.className = "request-history";
  const historySummary = document.createElement("summary");
  historySummary.textContent = "Change history";
  const historyContent = document.createElement("div");
  const historyNotice = document.createElement("p");
  historyNotice.setAttribute("role", "status");
  const historyMore = document.createElement("button");
  historyMore.type = "button";
  historyMore.className = "button button-secondary";
  historyMore.textContent = "Load older changes";
  historyMore.hidden = true;
  const historyRefresh = document.createElement("button");
  historyRefresh.type = "button";
  historyRefresh.className = "button button-secondary";
  historyRefresh.textContent = "Refresh history";
  let historyLoaded = false;
  let historyCursor: string | null = null;
  const loadHistory = async (append = false) => {
    if (historyRefresh.disabled) return;
    historyRefresh.disabled = true;
    historyMore.disabled = true;
    historyNotice.textContent = "Loading history…";
    try {
      const parameters = new URLSearchParams({ limit: "25" });
      if (append && historyCursor) parameters.set("cursor", historyCursor);
      const page = await api<Page<RequestHistoryEntry>>(`/api/requests/${request.id}/history?${parameters}`);
      if (!append) historyContent.replaceChildren();
      for (const entry of page.items) {
        const item = document.createElement("div");
        item.className = "history-entry";
        const label = document.createElement("strong");
        label.textContent = `${new Date(entry.changedAt).toLocaleString()} · ${entry.field.toLowerCase()}`;
        const values = document.createElement("p");
        values.textContent = entry.field === "CREATED" ? `Created: ${entry.newValue}`
          : `${entry.oldValue ?? "Unassigned"} → ${entry.newValue ?? "Unassigned"}`;
        item.append(label, values);
        historyContent.append(item);
      }
      historyNotice.textContent = !append && !page.items.length ? "No recorded changes." : "";
      historyCursor = page.nextCursor;
      historyMore.hidden = historyCursor === null;
      historyLoaded = true;
    } catch (error) {
      historyNotice.textContent = `Could not load history: ${errorMessage(error)}`;
    } finally {
      historyRefresh.disabled = false;
      historyMore.disabled = false;
    }
  };
  history.addEventListener("toggle", () => {
    if (history.open && !historyLoaded) void loadHistory();
  });
  historyRefresh.addEventListener("click", () => void loadHistory());
  historyMore.addEventListener("click", () => void loadHistory(true));
  history.append(historySummary, historyRefresh, historyContent, historyNotice, historyMore);

  controls.append(statusControl.field, priorityControl.field);
  card.append(headingRow, description, meta, editButton, editForm, controls, assignmentForm, history);

  return card;
}

function renderRequests(append = false): void {
  const query = activeQuery.toLowerCase();
  const filtered = requests.filter((request) =>
    `${request.title} ${request.description} ${request.id} ${request.assignee ?? ""}`
      .toLowerCase()
      .includes(query)
  );

  $("total-count").textContent = String(counts.total);
  $("new-count").textContent = String(counts.newCount);
  $("progress-count").textContent = String(counts.inProgressCount);
  $("resolved-count").textContent = String(counts.resolvedCount);

  $("request-summary").textContent = query
    ? `${filtered.length} matching requests loaded`
    : `Showing ${requests.length} of ${counts.total} requests`;
  loadMoreButton.hidden = nextCursor === null;
  loadMoreButton.disabled = requestsLoading || searchInput.value.trim() !== activeQuery;

  if (!append) requestList.replaceChildren();
  const renderedIds = new Set(Array.from(requestList.children, (card) => (card as HTMLElement).dataset.requestId));

  for (const request of filtered) {
    if (!renderedIds.has(request.id)) requestList.append(createRequestCard(request));
  }

  emptyState.hidden = filtered.length !== 0;
  $("empty-title").textContent = query
    ? "No matching requests"
    : "No requests yet";
  $("empty-description").textContent = query
    ? "Try another search term."
    : "Create your first request using the form.";
}

async function loadRequests(append = false): Promise<void> {
  window.clearTimeout(searchTimer);
  if (append && (requestsLoading || !nextCursor || searchInput.value.trim() !== activeQuery)) return;
  const load = ++loadSequence;
  const revision = dataRevision;
  const query = append ? activeQuery : searchInput.value.trim();
  requestsLoading = true;
  loadMoreButton.disabled = true;
  loadingPlaceholder.hidden = false;

  try {
    const parameters = new URLSearchParams({ limit: "25", q: query });
    if (append && nextCursor) parameters.set("cursor", nextCursor);
    const loaded = await api<RequestQueuePage>(`/api/requests?${parameters}`);
    if (load !== loadSequence) return;
    if (revision !== dataRevision) {
      void loadRequests();
      return;
    }
    requests = append ? [...requests, ...loaded.items.filter((item) => !requests.some((existing) => existing.id === item.id))]
      : loaded.items;
    counts = loaded.counts;
    nextCursor = loaded.nextCursor;
    activeQuery = query;
    setConnectionStatus(true);
    renderRequests(append);
  } catch (error) {
    if (load !== loadSequence || revision !== dataRevision) return;
    setConnectionStatus(false);
    showNotice(
      `Could not load requests. Make sure the backend and PostgreSQL are running. ${errorMessage(error)}`,
      "error"
    );
  } finally {
    if (load === loadSequence) {
      requestsLoading = false;
      loadingPlaceholder.hidden = true;
      loadMoreButton.disabled = searchInput.value.trim() !== activeQuery;
    }
  }
}

function updateCharacterCounts(): void {
  $("title-count").textContent = `${titleInput.value.length} / 120`;
  $("description-count").textContent = `${descriptionInput.value.length} / 2000`;
}

titleInput.addEventListener("input", updateCharacterCounts);
descriptionInput.addEventListener("input", updateCharacterCounts);
searchInput.addEventListener("input", () => {
  ++loadSequence;
  window.clearTimeout(searchTimer);
  loadMoreButton.disabled = true;
  searchTimer = window.setTimeout(() => void loadRequests(), 250);
});
loadMoreButton.addEventListener("click", () => void loadRequests(true));
$("refresh-button").addEventListener("click", () => void loadRequests());

createForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const title = titleInput.value.trim();
  const description = descriptionInput.value.trim();

  if (!title || !description) {
    showNotice("Enter both a title and a description.", "error");
    return;
  }

  createButton.disabled = true;
  createButton.textContent = "Creating…";

  try {
    const created = await api<ServiceRequest>("/api/requests", {
      method: "POST",
      body: JSON.stringify({
        title,
        description,
        priority: priorityInput.value
      })
    });

    dataRevision++;
    counts.total++;
    counts.newCount++;
    requests = [created, ...requests];
    createForm.reset();
    priorityInput.value = "MEDIUM";
    updateCharacterCounts();
    renderRequests();
    showNotice("Request created successfully.", "success");
    titleInput.focus();
  } catch (error) {
    showNotice(`Could not create request: ${errorMessage(error)}`, "error");
  } finally {
    createButton.disabled = false;
    createButton.textContent = "Create request";
  }
});

updateCharacterCounts();
void loadRequests();
