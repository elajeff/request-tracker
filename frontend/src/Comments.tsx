import { useRef, useState } from "react";
import type { Api, Page, RequestComment, ServiceRequest } from "./types";
import { errorMessage, uniqueById } from "./helpers";

export function Comments({
  request,
  api,
}: {
  request: ServiceRequest;
  api: Api;
}) {
  const [comments, setComments] = useState<RequestComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const lock = useRef(false);
  const posting = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  async function load(append = false) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "25" });
      if (append && cursor) params.set("cursor", cursor);
      const page = await api<Page<RequestComment>>(
        `/api/requests/${request.id}/comments?${params}`,
      );
      setComments((previous) => uniqueById([...previous, ...page.items]));
      setCursor(page.nextCursor);
      setLoaded(true);
    } catch (failure) {
      setError(`Could not load comments: ${errorMessage(failure)}`);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <details
      className="request-comments"
      onToggle={(event) => {
        if (event.currentTarget.open && !loaded) void load();
      }}
    >
      <summary>Comments</summary>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (posting.current) return;
          posting.current = true;
          setError("");
          try {
            const created = await api<RequestComment>(
              `/api/requests/${request.id}/comments`,
              { method: "POST", body: JSON.stringify({ body: text }) },
            );
            setComments((previous) => uniqueById([created, ...previous]));
            setText("");
            textarea.current?.focus();
          } catch (failure) {
            setError(`Could not add comment: ${errorMessage(failure)}`);
          } finally {
            posting.current = false;
          }
        }}
      >
        <label className="form-field">
          <span>New comment</span>
          <textarea
            ref={textarea}
            maxLength={2000}
            rows={3}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <small className="field-hint">{text.length} / 2000</small>
        </label>
        <button className="button button-primary" disabled={!text.trim()}>
          Add comment
        </button>
      </form>
      <p role="status">
        {busy
          ? "Loading comments…"
          : error || (loaded && !comments.length ? "No comments yet." : "")}
      </p>
      <ol className="comment-list" aria-label={`Comments on ${request.title}`}>
        {comments.map((comment) => (
          <li className="comment-entry" key={comment.id}>
            <strong>
              {new Date(comment.createdAt).toLocaleString()} ·{" "}
              {comment.authorUsername}
            </strong>
            <p>{comment.body}</p>
          </li>
        ))}
      </ol>
      {cursor && (
        <button
          className="button button-secondary"
          disabled={busy}
          onClick={() => void load(true)}
        >
          Load older comments
        </button>
      )}
    </details>
  );
}
