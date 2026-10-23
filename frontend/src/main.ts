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
}

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

let requests: ServiceRequest[] = [];

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
  editForm.hidden = true;

  const editTitleField = document.createElement("label");
  editTitleField.className = "form-field";
  const editTitleLabel = document.createElement("span");
  editTitleLabel.textContent = "Title";
  const editTitle = document.createElement("input");
  editTitle.type = "text";
  editTitle.maxLength = 120;
  editTitle.required = true;
  editTitle.value = request.title;
  editTitleField.append(editTitleLabel, editTitle);

  const editDescriptionField = document.createElement("label");
  editDescriptionField.className = "form-field";
  const editDescriptionLabel = document.createElement("span");
  editDescriptionLabel.textContent = "Description";
  const editDescription = document.createElement("textarea");
  editDescription.rows = 3;
  editDescription.maxLength = 2000;
  editDescription.required = true;
  editDescription.value = request.description;
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

  editButton.addEventListener("click", () => {
    editTitle.value = request.title;
    editDescription.value = request.description;
    editForm.hidden = false;
    editButton.hidden = true;
    editTitle.focus();
  });

  cancelButton.addEventListener("click", () => {
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

      requests = requests.map((item) => item.id === updated.id ? updated : item);
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

      requests = requests.map((item) => item.id === updated.id ? updated : item);
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

      requests = requests.map((item) => item.id === updated.id ? updated : item);
      renderRequests();
      showNotice("Priority updated.", "success");
    } catch (error) {
      showNotice(`Priority update failed: ${errorMessage(error)}`, "error");
      await loadRequests();
    }
  });

  controls.append(statusControl.field, priorityControl.field);
  card.append(headingRow, description, meta, editButton, editForm, controls);

  return card;
}

function renderRequests(): void {
  const query = searchInput.value.trim().toLocaleLowerCase();
  const filtered = requests.filter((request) =>
    `${request.title} ${request.description} ${request.id}`
      .toLocaleLowerCase()
      .includes(query)
  );

  $("total-count").textContent = String(requests.length);
  $("new-count").textContent = String(
    requests.filter((request) => request.status === "NEW").length
  );
  $("progress-count").textContent = String(
    requests.filter((request) => request.status === "IN_PROGRESS").length
  );
  $("resolved-count").textContent = String(
    requests.filter((request) => request.status === "RESOLVED").length
  );

  $("request-summary").textContent = query
    ? `Showing ${filtered.length} of ${requests.length} requests`
    : `${requests.length} ${requests.length === 1 ? "request" : "requests"}`;

  requestList.replaceChildren();

  for (const request of filtered) {
    requestList.append(createRequestCard(request));
  }

  emptyState.hidden = filtered.length !== 0;
  $("empty-title").textContent = query
    ? "No matching requests"
    : "No requests yet";
  $("empty-description").textContent = query
    ? "Try another search term."
    : "Create your first request using the form.";
}

async function loadRequests(): Promise<void> {
  loadingPlaceholder.hidden = false;

  try {
    requests = await api<ServiceRequest[]>("/api/requests");
    setConnectionStatus(true);
    renderRequests();
  } catch (error) {
    setConnectionStatus(false);
    requests = [];
    renderRequests();
    showNotice(
      `Could not load requests. Make sure the backend and PostgreSQL are running. ${errorMessage(error)}`,
      "error"
    );
  } finally {
    loadingPlaceholder.hidden = true;
  }
}

function updateCharacterCounts(): void {
  $("title-count").textContent = `${titleInput.value.length} / 120`;
  $("description-count").textContent = `${descriptionInput.value.length} / 2000`;
}

titleInput.addEventListener("input", updateCharacterCounts);
descriptionInput.addEventListener("input", updateCharacterCounts);
searchInput.addEventListener("input", renderRequests);
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
