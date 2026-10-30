import { useRef, useState } from "react";
import type { Api, ServiceRequest } from "./types";
import { errorMessage } from "./useSession";

export function CreateRequest({
  api,
  support,
  onCreated,
  notify,
}: {
  api: Api;
  support: boolean;
  onCreated: (item: ServiceRequest) => void;
  notify: (message: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        if (!title.trim() || !description.trim()) {
          notify("Enter both a title and a description.");
          return;
        }
        setBusy(true);
        try {
          const created = await api<ServiceRequest>("/api/requests", {
            method: "POST",
            body: JSON.stringify({
              title: title.trim(),
              description: description.trim(),
              priority: support ? priority : "MEDIUM",
            }),
          });
          onCreated(created);
          setTitle("");
          setDescription("");
          setPriority("MEDIUM");
          notify("Request created successfully.");
          input.current?.focus();
        } catch (error) {
          notify(`Could not create request: ${errorMessage(error)}`);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="form-field">
        <span>
          Title <span className="required">*</span>
        </span>
        <input
          ref={input}
          required
          maxLength={120}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <small className="field-hint">{title.length} / 120</small>
      </label>
      <label className="form-field">
        <span>
          Description <span className="required">*</span>
        </span>
        <textarea
          required
          maxLength={2000}
          rows={4}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <small className="field-hint">{description.length} / 2000</small>
      </label>
      {support && (
        <label className="form-field">
          <span>Priority</span>
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          >
            {["HIGH", "MEDIUM", "LOW"].map((value) => (
              <option key={value} value={value}>
                {value[0] + value.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </label>
      )}
      <button className="button button-primary button-full" disabled={busy}>
        {busy ? "Creating…" : "Create request"}
      </button>
    </form>
  );
}
