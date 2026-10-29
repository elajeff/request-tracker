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
  assigneeId: string | null;
  assigneeActive: boolean | null;
}

interface SupportStaff {
  id: string;
  name: string;
  active: boolean;
}

interface RequestHistoryEntry {
  id: number;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changedAt: string;
  actorUsername: string | null;
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
const staffFilter = $("staff-filter") as HTMLSelectElement;
const staffNotice = $("staff-notice");
const staffMoreButton = $("staff-more-button") as HTMLButtonElement;
const staffCreateButton = $("staff-create-button") as HTMLButtonElement;
const staffNameInput = $("staff-name-input") as HTMLInputElement;

let requests: ServiceRequest[] = [];
let loadSequence = 0;
let dataRevision = 0;
let nextCursor: string | null = null;
let activeQuery = "";
let activeStaffFilter = "";
let requestsLoading = false;
let searchTimer: number | undefined;
let counts: RequestCounts = { total: 0, newCount: 0, inProgressCount: 0, resolvedCount: 0 };
const drafts = new Map<string, { title: string; description: string }>();
let staff: SupportStaff[] = [];
let staffCursor: string | null = null;
let staffLoading = false;
let staffLoadSequence = 0;
const staffNameDrafts = new Map<string, string>();

interface SessionView {
  user: { id: string; username: string; role: "REQUESTER" | "SUPPORT" } | null;
  csrfToken: string;
  csrfHeaderName: string;
}
let session: SessionView | null = null;
let sessionGeneration = 0;
const isSupport = () => session?.user?.role === "SUPPORT";

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const generation = sessionGeneration;
  const headers = new Headers(options.headers);
  if (options.method && !["GET", "HEAD"].includes(options.method) && session) {
    headers.set(session.csrfHeaderName, session.csrfToken);
  }
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  if (generation !== sessionGeneration) throw new Error("Session changed; response ignored.");
  if (response.status === 401 && path !== "/api/session/login") {
    clearSession("Your session ended. Sign in again.");
    void refreshSession();
    throw new Error("Sign in required.");
  }
  if (response.status === 403 && session?.user) {
    await refreshSession();
    if (generation !== sessionGeneration) throw new Error("Sign in required.");
  }
  const text = await response.text();
  if (generation !== sessionGeneration) throw new Error("Session changed; response ignored.");

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
  card.setAttribute("aria-labelledby", `request-title-${request.id}`);

  const headingRow = document.createElement("div");
  headingRow.className = "request-heading-row";

  const titleBlock = document.createElement("div");
  titleBlock.className = "request-title-block";

  const title = document.createElement("h3");
  title.id = `request-title-${request.id}`;
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

  editButton.hidden = !editForm.hidden || (!isSupport() && request.status !== "NEW");
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
  const assignee = document.createElement("select");
  assignee.className = "control-select assignment-select";
  assignee.dataset.requestId = request.id;
  assignee.setAttribute("aria-label", `Assigned staff for ${request.title}`);
  fillAssignmentOptions(assignee, request);
  assignee.addEventListener("change", () => assignmentDrafts.set(request.id, assignee.value));
  assignmentField.append(assignmentLabel, assignee);
  const assignButton = document.createElement("button");
  assignButton.type = "submit";
  assignButton.className = "button button-secondary";
  assignButton.textContent = "Save assignment";
  const assignmentHelp = document.createElement("small");
  assignmentHelp.textContent = "Choose Unassigned to clear. More staff are available under Manage support staff.";
  assignmentForm.append(assignmentField, assignButton, assignmentHelp);
  assignmentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    assignButton.disabled = true;
    try {
      const updated = await api<ServiceRequest>(`/api/requests/${request.id}/assignment`, {
        method: "PATCH", body: JSON.stringify(assignee.value ? { staffId: assignee.value } : { unassign: true })
      });
      assignmentDrafts.delete(request.id);
      dataRevision++;
      requests = requests.map((item) => item.id === updated.id
        ? { ...item, assignee: updated.assignee, assigneeId: updated.assigneeId, assigneeActive: updated.assigneeActive } : item);
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
  const historyContent = document.createElement("ol");
  historyContent.className = "history-list";
  historyContent.setAttribute("aria-label", `Change history for ${request.title}`);
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
        const item = document.createElement("li");
        item.className = "history-entry";
        const label = document.createElement("strong");
        label.textContent = `${new Date(entry.changedAt).toLocaleString()} · ${entry.field.toLowerCase()} · ${entry.actorUsername ?? "Actor not recorded"}`;
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
  controls.hidden = !isSupport();
  assignmentForm.hidden = !isSupport();
  const assignedLabel = document.createElement("p");
  assignedLabel.textContent = `Assigned staff: ${request.assignee ?? "Unassigned"}`;
  assignedLabel.hidden = isSupport();
  card.append(headingRow, description, meta, editButton, editForm, controls, assignmentForm, assignedLabel, history);

  return card;
}

function renderRequests(append = false): void {
  const query = activeQuery.toLowerCase();
  const filtered = requests.filter((request) =>
    `${request.title} ${request.description} ${request.id} ${request.assignee ?? ""}`
      .toLowerCase()
      .includes(query)
      && (!activeStaffFilter || (activeStaffFilter === "unassigned" ? request.assigneeId === null
        : request.assigneeId === activeStaffFilter))
  );

  $("total-count").textContent = String(counts.total);
  $("new-count").textContent = String(counts.newCount);
  $("progress-count").textContent = String(counts.inProgressCount);
  $("resolved-count").textContent = String(counts.resolvedCount);

  $("request-summary").textContent = query || activeStaffFilter
    ? `${filtered.length} matching requests loaded`
    : `Showing ${requests.length} of ${counts.total} requests`;
  loadMoreButton.hidden = nextCursor === null;
  loadMoreButton.disabled = requestsLoading || searchInput.value.trim() !== activeQuery || staffFilter.value !== activeStaffFilter;

  if (!append) requestList.replaceChildren();
  const renderedIds = new Set(Array.from(requestList.children, (card) => (card as HTMLElement).dataset.requestId));

  for (const request of filtered) {
    if (!renderedIds.has(request.id)) requestList.append(createRequestCard(request));
  }

  emptyState.hidden = filtered.length !== 0;
  $("empty-title").textContent = query || activeStaffFilter
    ? "No matching requests"
    : "No requests yet";
  $("empty-description").textContent = query || activeStaffFilter
    ? "Try another search term or staff filter."
    : "Create your first request using the form.";
}

async function loadRequests(append = false): Promise<void> {
  if (!session?.user) return;
  window.clearTimeout(searchTimer);
  if (append && (requestsLoading || !nextCursor || searchInput.value.trim() !== activeQuery
      || staffFilter.value !== activeStaffFilter)) return;
  const load = ++loadSequence;
  const revision = dataRevision;
  const query = append ? activeQuery : searchInput.value.trim();
  const selectedStaff = append ? activeStaffFilter : staffFilter.value;
  requestsLoading = true;
  loadMoreButton.disabled = true;
  loadingPlaceholder.hidden = false;

  try {
    const parameters = new URLSearchParams({ limit: "25", q: query });
    if (selectedStaff === "unassigned") parameters.set("unassigned", "true");
    else if (selectedStaff) parameters.set("staffId", selectedStaff);
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
    activeStaffFilter = selectedStaff;
    refreshStaffOptions();
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
      loadMoreButton.disabled = searchInput.value.trim() !== activeQuery || staffFilter.value !== activeStaffFilter;
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
staffFilter.addEventListener("change", () => void loadRequests());
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
        priority: isSupport() ? priorityInput.value : "MEDIUM"
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


function staffLabel(person: SupportStaff): string {
  return `${person.name.trim() ? person.name : "(blank legacy name)"} [${person.id}]${person.active ? "" : " — inactive"}`;
}

function fillAssignmentOptions(select: HTMLSelectElement, request: ServiceRequest): void {
  const selected = assignmentDrafts.get(request.id) ?? request.assigneeId ?? "";
  select.replaceChildren(new Option("Unassigned", ""));
  const choices = staff.filter((person) => person.active);
  if (request.assigneeId && !choices.some((person) => person.id === request.assigneeId)) {
    choices.push(staff.find((person) => person.id === request.assigneeId)
      ?? { id: request.assigneeId, name: request.assignee ?? "", active: request.assigneeActive === true });
  }
  for (const person of choices.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))) {
    const option = new Option(staffLabel(person), person.id);
    option.disabled = !person.active;
    select.append(option);
  }
  if (selected && !choices.some((person) => person.id === selected)) {
    const person = staff.find((item) => item.id === selected);
    const option = new Option(person ? staffLabel(person) : `Previously selected staff [${selected}]`, selected);
    option.disabled = person?.active === false;
    select.append(option);
  }
  select.value = selected;
}

function refreshStaffOptions(): void {
  const selected = staffFilter.value;
  const known = new Map(staff.map((person) => [person.id, person]));
  for (const request of requests) {
    if (request.assigneeId && !known.has(request.assigneeId)) {
      known.set(request.assigneeId, { id: request.assigneeId, name: request.assignee ?? "", active: request.assigneeActive === true });
    }
  }
  staffFilter.replaceChildren(new Option("All staff", ""), new Option("Unassigned", "unassigned"));
  for (const person of [...known.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))) {
    staffFilter.append(new Option(staffLabel(person), person.id));
  }
  if (selected && selected !== "unassigned" && !known.has(selected)) {
    staffFilter.append(new Option(`Staff [${selected}]`, selected));
  }
  staffFilter.value = selected;
  for (const select of requestList.querySelectorAll<HTMLSelectElement>(".assignment-select")) {
    const request = requests.find((item) => item.id === select.dataset.requestId);
    if (request) fillAssignmentOptions(select, request);
  }
}

function staffSaved(person: SupportStaff): void {
  ++staffLoadSequence;
  staffLoading = false;
  dataRevision++;
  staff = staff.some((item) => item.id === person.id)
    ? staff.map((item) => item.id === person.id ? person : item) : [...staff, person];
  requests = requests.map((item) => item.assigneeId === person.id
    ? { ...item, assignee: person.name, assigneeActive: person.active } : item);
  renderStaff();
  refreshStaffOptions();
  renderRequests();
  staffNotice.textContent = "Staff record saved. Existing assignments and historical values are retained.";
}

function renderStaff(): void {
  $("staff-list").replaceChildren();
  for (const person of staff) {
    const row = document.createElement("form");
    row.className = "staff-record";
    const identity = document.createElement("small");
    identity.textContent = `${person.active ? "Active" : "Inactive"} · ${person.id}`;
    const name = document.createElement("input");
    name.value = staffNameDrafts.get(person.id) ?? person.name;
    name.maxLength = 120;
    name.required = true;
    name.setAttribute("aria-label", `Name for staff ${person.id}`);
    name.addEventListener("input", () => staffNameDrafts.set(person.id, name.value));
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "button button-secondary";
    save.textContent = "Save name";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "button button-secondary";
    toggle.textContent = person.active ? "Deactivate" : "Reactivate";
    const update = async (rename: boolean) => {
      if (rename && !name.value.trim()) {
        staffNotice.textContent = "Enter a staff name.";
        return;
      }
      save.disabled = true;
      toggle.disabled = true;
      try {
        const updated = await api<SupportStaff>(`/api/staff/${person.id}${rename ? "" : "/active"}`, {
          method: rename ? "PUT" : "PATCH",
          body: JSON.stringify(rename ? { name: name.value.trim() } : { active: !person.active })
        });
        if (rename) staffNameDrafts.delete(person.id);
        staffSaved(updated);
      } catch (error) {
        staffNotice.textContent = `Could not save staff: ${errorMessage(error)}`;
      } finally {
        save.disabled = false;
        toggle.disabled = false;
      }
    };
    row.addEventListener("submit", (event) => { event.preventDefault(); void update(true); });
    toggle.addEventListener("click", () => void update(false));
    row.append(identity, name, save, toggle);
    $("staff-list").append(row);
  }
  staffMoreButton.hidden = staffCursor === null;
  staffMoreButton.disabled = staffLoading;
}

async function loadStaff(append = false): Promise<void> {
  if (!isSupport()) return;
  if (append && (staffLoading || !staffCursor)) return;
  const load = ++staffLoadSequence;
  staffLoading = true;
  staffMoreButton.disabled = true;
  staffNotice.textContent = "Loading staff…";
  try {
    const parameters = new URLSearchParams({ limit: "25" });
    if (append && staffCursor) parameters.set("cursor", staffCursor);
    const page = await api<Page<SupportStaff>>(`/api/staff?${parameters}`);
    if (load !== staffLoadSequence) return;
    staff = append ? [...staff, ...page.items.filter((person) => !staff.some((item) => item.id === person.id))] : page.items;
    staffCursor = page.nextCursor;
    renderStaff();
    refreshStaffOptions();
    staffNotice.textContent = `${staff.length} staff loaded.${staffCursor ? " Load more to see additional staff and assignment options." : ""}`;
  } catch (error) {
    if (load === staffLoadSequence) staffNotice.textContent = `Could not load staff: ${errorMessage(error)}. Use Refresh staff to retry.`;
  } finally {
    if (load === staffLoadSequence) {
      staffLoading = false;
      staffMoreButton.disabled = false;
    }
  }
}

$("staff-create-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = staffNameInput.value.trim();
  if (!name) { staffNotice.textContent = "Enter a staff name."; return; }
  staffCreateButton.disabled = true;
  try {
    const created = await api<SupportStaff>("/api/staff", { method: "POST", body: JSON.stringify({ name }) });
    staffNameInput.value = "";
    staffSaved(created);
  } catch (error) {
    staffNotice.textContent = `Could not create staff: ${errorMessage(error)}`;
  } finally {
    staffCreateButton.disabled = false;
  }
});
staffMoreButton.addEventListener("click", () => void loadStaff(true));
$("staff-refresh-button").addEventListener("click", () => void loadStaff());

function clearSession(message: string): void {
  ++sessionGeneration;
  ++loadSequence;
  ++staffLoadSequence;
  ++dataRevision;
  window.clearTimeout(searchTimer);
  session = null;
  requests = [];
  staff = [];
  drafts.clear();
  assignmentDrafts.clear();
  staffNameDrafts.clear();
  nextCursor = null;
  staffCursor = null;
  activeQuery = "";
  activeStaffFilter = "";
  requestsLoading = false;
  staffLoading = false;
  counts = { total: 0, newCount: 0, inProgressCount: 0, resolvedCount: 0 };
  requestList.replaceChildren();
  $("staff-list").replaceChildren();
  searchInput.value = "";
  staffFilter.replaceChildren(new Option("All staff", ""), new Option("Unassigned", "unassigned"));
  createForm.reset();
  ($<HTMLFormElement>("staff-create-form")).reset();
  updateCharacterCounts();
  $("dashboard").hidden = true;
  $("login-panel").hidden = false;
  $("login-notice").textContent = message;
  showNotice("");
}

async function refreshSession(): Promise<void> {
  const generation = sessionGeneration;
  try {
    const response = await fetch("/api/session", { credentials: "same-origin", cache: "no-store" });
    if (generation !== sessionGeneration) return;
    if (response.status === 401) {
      clearSession("Your session ended. Sign in again.");
      void refreshSession();
      return;
    }
    if (!response.ok) throw new Error("Could not connect. Use Retry connection.");
    const loaded = await response.json() as SessionView;
    if (generation !== sessionGeneration) return;
    if (session?.user && session.user.id !== loaded.user?.id) {
      clearSession("Your session ended. Sign in again.");
    }
    const wasSignedIn = !!session?.user;
    session = loaded;
    $<HTMLButtonElement>("login-button").disabled = false;
    if (!loaded.user) {
      if (!$("login-notice").textContent || $("login-notice").textContent === "Connecting…") {
        $("login-notice").textContent = "Enter your username and password.";
      }
      return;
    }
    $("login-panel").hidden = true;
    $("dashboard").hidden = false;
    $("account-label").textContent = `${loaded.user.username} · ${loaded.user.role.toLowerCase()}`;
    $("staff-directory").hidden = !isSupport();
    $("staff-filter-field").hidden = !isSupport();
    $("create-priority-field").hidden = !isSupport();
    if (!wasSignedIn) {
      void loadStaff();
      void loadRequests();
    }
  } catch (error) {
    if (generation === sessionGeneration) $("login-notice").textContent = errorMessage(error);
  }
}

$("login-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = $<HTMLButtonElement>("login-button");
  const password = $<HTMLInputElement>("login-password");
  button.disabled = true;
  try {
    const body = new URLSearchParams({ username: $<HTMLInputElement>("login-username").value, password: password.value });
    password.value = "";
    await api<void>("/api/session/login", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
    });
    clearSession("");
    await refreshSession();
  } catch (error) {
    $("login-notice").textContent = errorMessage(error);
    await refreshSession();
  } finally {
    password.value = "";
    button.disabled = session === null;
  }
});
$("logout-button").addEventListener("click", async () => {
  try {
    await api<void>("/api/session/logout", { method: "POST" });
    clearSession("Signed out.");
    await refreshSession();
  } catch (error) {
    showNotice(`Could not sign out: ${errorMessage(error)}`, "error");
  }
});
$("session-refresh").addEventListener("click", () => void refreshSession());
void refreshSession();
