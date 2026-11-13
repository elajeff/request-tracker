import { useCallback, useEffect, useRef, useState } from "react";
import type { Api, SessionView } from "./types";
import { errorMessage } from "./helpers";

export function useSession() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [notice, setNotice] = useState("Connecting…");
  // Bumped when the session ends. The dashboard is keyed on it so private state is
  // dropped, and responses started under an older session are ignored.
  const [generation, setGeneration] = useState(0);
  const epoch = useRef(0);
  const current = useRef<SessionView | null>(null);
  const refreshSequence = useRef(0);
  const clear = useCallback((message: string) => {
    epoch.current++;
    setGeneration(epoch.current);
    current.current = null;
    setSession(null);
    setNotice(message);
  }, []);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const startedIn = epoch.current;
    try {
      const response = await fetch("/api/session", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (sequence !== refreshSequence.current || startedIn !== epoch.current)
        return;
      if (!response.ok)
        throw new Error("Could not connect. Use Retry connection.");
      const loaded: SessionView = await response.json();
      if (sequence !== refreshSequence.current || startedIn !== epoch.current)
        return;
      if (current.current?.user && current.current.user.id !== loaded.user?.id)
        clear("Your session ended. Sign in again.");
      current.current = loaded;
      setSession(loaded);
      setNotice((previous) =>
        previous === "Connecting…"
          ? "Enter your username and password."
          : previous,
      );
    } catch (error) {
      if (sequence === refreshSequence.current && startedIn === epoch.current)
        setNotice(errorMessage(error));
    }
  }, [clear]);
  const api: Api = useCallback(
    async <T>(path: string, options: RequestInit = {}): Promise<T> => {
      const startedIn = epoch.current;
      const headers = new Headers(options.headers);
      if (
        options.method &&
        !["GET", "HEAD"].includes(options.method) &&
        current.current
      ) {
        headers.set(current.current.csrfHeaderName, current.current.csrfToken);
      }
      if (options.body && !headers.has("Content-Type"))
        headers.set("Content-Type", "application/json");
      const response = await fetch(path, {
        ...options,
        headers,
        credentials: "same-origin",
      });
      if (startedIn !== epoch.current)
        throw new Error("Session changed; response ignored.");
      if (response.status === 401 && path !== "/api/session/login") {
        clear("Your session ended. Sign in again.");
        void refresh();
        throw new Error("Sign in required.");
      }
      if (response.status === 403 && current.current?.user) await refresh();
      const text = await response.text();
      if (startedIn !== epoch.current)
        throw new Error("Session changed; response ignored.");
      if (!response.ok) {
        let message = text || `${response.status} ${response.statusText}`;
        try {
          const body = JSON.parse(text);
          message = body.detail ?? body.title ?? message;
        } catch {
          /* Non-JSON proxy errors remain readable. */
        }
        throw new Error(message);
      }
      return (text ? JSON.parse(text) : undefined) as T;
    },
    [clear, refresh],
  );
  useEffect(() => {
    // refresh only sets state after the response arrives; the rule cannot see past the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);
  return {
    session,
    notice,
    setNotice,
    clear,
    refresh,
    api,
    generation,
  };
}
