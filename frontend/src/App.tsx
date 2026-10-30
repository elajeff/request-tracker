import { useState } from "react";
import { useSession, errorMessage } from "./useSession";
import { Dashboard } from "./Dashboard";

export function App() {
  const auth = useSession();
  const [connected, setConnected] = useState(true);
  const [busy, setBusy] = useState(false);
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Request Tracker home">
          <span className="brand-mark">R</span>
          <span>Request Tracker</span>
        </a>
        <div className="connection-status">
          <span
            className={`connection-indicator ${connected && auth.session ? "connected" : "disconnected"}`}
          />
          {auth.session
            ? connected
              ? "API connected"
              : "API unavailable"
            : "Connecting to API"}
        </div>
      </header>
      {auth.session?.user ? (
        <Dashboard
          key={`${auth.generation}-${auth.session.user.id}`}
          api={auth.api}
          onConnection={setConnected}
          support={auth.session.user.role === "SUPPORT"}
          username={auth.session.user.username}
          logout={async () => {
            await auth.api<void>("/api/session/logout", { method: "POST" });
            auth.clear("Signed out.");
            await auth.refresh();
          }}
        />
      ) : (
        <section
          id="login-panel"
          className="panel login-panel"
          aria-labelledby="login-heading"
        >
          <h1 id="login-heading">Sign in</h1>
          <p>Use a locally provisioned Request Tracker account.</p>
          <form
            id="login-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              const form = event.currentTarget;
              const data = new FormData(form);
              const body = new URLSearchParams({
                username: String(data.get("username")),
                password: String(data.get("password")),
              });
              form.reset();
              setBusy(true);
              try {
                await auth.api<void>("/api/session/login", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                  },
                  body,
                });
                auth.clear("");
                await auth.refresh();
              } catch (error) {
                auth.setNotice(errorMessage(error));
                await auth.refresh();
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="form-field">
              <span>Username</span>
              <input
                name="username"
                autoComplete="username"
                required
                maxLength={64}
              />
            </label>
            <label className="form-field">
              <span>Password</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <button
              id="login-button"
              className="button button-primary"
              disabled={busy || !auth.session}
            >
              Sign in
            </button>
          </form>
          <p id="login-notice" role="status">
            {auth.notice}
          </p>
          <button
            className="button button-secondary"
            onClick={() => void auth.refresh()}
          >
            Retry connection
          </button>
        </section>
      )}
    </div>
  );
}
