import { useState } from "react";

import type { Account, Api, Role } from "./types";
import { usePagedList } from "./usePagedList";

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;

interface Props {
  api: Api;
  username: string;
  // Resetting your own password ends your session on the server.
  onOwnSessionEnded: () => void;
}

const accountUsername = (account: Account) => account.username;
const normalize = (query: string) => query.trim().toLowerCase();
const matches = (account: Account, search: string) =>
  account.username.includes(search);

function passwordProblem(password: string) {
  return password.length < 12 || new TextEncoder().encode(password).length > 72
    ? "Passwords need at least 12 characters and at most 72 bytes."
    : "";
}

export function AccountManagement({ api, username, onOwnSessionEnded }: Props) {
  const {
    items: accounts,
    cursor,
    query,
    search,
    loading,
    saving,
    disabled,
    error,
    notice,
    retryFrom,
    setError,
    load,
    run,
    show,
    changeQuery,
  } = usePagedList<Account>(api, {
    path: "/api/accounts",
    key: accountUsername,
    normalize,
    matches,
    loadFailed: "Could not load accounts",
    saveFailed: "Could not save account",
  });
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<Role>("REQUESTER");

  function create() {
    if (!USERNAME_PATTERN.test(newUsername)) {
      setError(
        "Usernames are 3-64 lowercase letters, digits, dots, underscores or hyphens.",
      );
      return;
    }
    const problem = passwordProblem(newPassword);
    if (problem) {
      setError(problem);
      return;
    }
    void run(async () => {
      show(
        await api<Account>("/api/accounts", {
          method: "POST",
          body: JSON.stringify({
            username: newUsername,
            role: newRole,
            password: newPassword,
          }),
        }),
      );
      setNewUsername("");
      setNewPassword("");
    }, "Account created.");
  }

  async function resetPassword(account: Account, password: string) {
    const problem = passwordProblem(password);
    if (problem) {
      setError(problem);
      return false;
    }
    const own = account.username === username;
    const saved = await run(
      () =>
        api<void>(`/api/accounts/${account.username}/password`, {
          method: "PUT",
          body: JSON.stringify({ password }),
        }),
      "Password reset.",
    );
    if (saved && own) onOwnSessionEnded();
    return saved;
  }

  return (
    <details className="account-directory">
      <summary>Manage accounts</summary>
      <p className="muted">
        Login accounts. Disabling an account, changing its role or resetting its
        password signs it out.
      </p>
      <form
        id="account-create-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <label className="form-field">
          <span>Username</span>
          <input
            value={newUsername}
            maxLength={64}
            autoComplete="off"
            required
            disabled={disabled}
            onChange={(event) => setNewUsername(event.target.value)}
          />
        </label>
        <label className="form-field">
          <span>Initial password</span>
          <input
            type="password"
            value={newPassword}
            autoComplete="new-password"
            required
            disabled={disabled}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </label>
        <label className="form-field">
          <span>Role</span>
          <select
            value={newRole}
            disabled={disabled}
            onChange={(event) => setNewRole(event.target.value as Role)}
          >
            <option value="REQUESTER">Requester</option>
            <option value="SUPPORT">Support</option>
          </select>
        </label>
        <button className="button button-secondary" disabled={disabled}>
          Create account
        </button>
      </form>
      <label className="form-field">
        <span>Search accounts</span>
        <input
          type="search"
          value={query}
          disabled={saving}
          onChange={(event) => changeQuery(event.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <p role="status">
        {loading
          ? "Loading accounts..."
          : saving
            ? "Saving account..."
            : `${accounts.length} accounts shown.${cursor ? " More accounts are available." : ""}`}
      </p>
      {notice && <p role="status">{notice}</p>}
      {search && !loading && !error && !accounts.length && cursor === null && (
        <p>No matching accounts.</p>
      )}
      <div aria-label="Accounts" aria-busy={disabled}>
        {accounts.map((account) => (
          <AccountRow
            key={`${account.username}-${account.role}`}
            account={account}
            own={account.username === username}
            disabled={disabled}
            changeRole={(role) =>
              void run(async () => {
                show(
                  await api<Account>(`/api/accounts/${account.username}/role`, {
                    method: "PATCH",
                    body: JSON.stringify({ role }),
                  }),
                );
              }, "Role changed.")
            }
            toggle={() =>
              void run(
                async () => {
                  show(
                    await api<Account>(
                      `/api/accounts/${account.username}/enabled`,
                      {
                        method: "PATCH",
                        body: JSON.stringify({ enabled: !account.enabled }),
                      },
                    ),
                  );
                },
                account.enabled ? "Account disabled." : "Account enabled.",
              )
            }
            resetPassword={(password) => resetPassword(account, password)}
          />
        ))}
      </div>
      {cursor && (
        <button
          className="button button-secondary"
          disabled={disabled}
          onClick={() => void load(cursor)}
        >
          Load more accounts
        </button>
      )}
      {retryFrom !== undefined && (
        <button
          className="button button-secondary"
          disabled={disabled}
          onClick={() => void load(retryFrom)}
        >
          Retry loading accounts
        </button>
      )}
      <button
        className="button button-secondary"
        disabled={disabled}
        onClick={() => void load(null)}
      >
        Refresh accounts
      </button>
    </details>
  );
}

function AccountRow({
  account,
  own,
  disabled,
  changeRole,
  toggle,
  resetPassword,
}: {
  account: Account;
  own: boolean;
  disabled: boolean;
  changeRole: (role: Role) => void;
  toggle: () => void;
  resetPassword: (password: string) => Promise<boolean>;
}) {
  const [role, setRole] = useState(account.role);
  const [password, setPassword] = useState("");
  return (
    <form
      className="account-record"
      aria-label={`Account ${account.username}`}
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        if (await resetPassword(password)) setPassword("");
      }}
    >
      <small>
        {[
          own ? `${account.username} (you)` : account.username,
          account.role === "SUPPORT" ? "Support" : "Requester",
          account.enabled ? "Active" : "Disabled",
        ].join(" · ")}
      </small>
      {/* Only another support user can change your role or disable you, so nobody locks themselves out. */}
      {!own && (
        <>
          <select
            aria-label={`Role for ${account.username}`}
            value={role}
            disabled={disabled}
            onChange={(event) => setRole(event.target.value as Role)}
          >
            <option value="REQUESTER">Requester</option>
            <option value="SUPPORT">Support</option>
          </select>
          <button
            className="button button-secondary"
            type="button"
            disabled={disabled || role === account.role}
            onClick={() => changeRole(role)}
          >
            Save role
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={disabled}
            onClick={toggle}
          >
            {account.enabled ? "Disable" : "Enable"}
          </button>
        </>
      )}
      <input
        type="password"
        aria-label={`New password for ${account.username}`}
        value={password}
        autoComplete="new-password"
        disabled={disabled}
        onChange={(event) => setPassword(event.target.value)}
      />
      <button className="button button-secondary" disabled={disabled}>
        Reset password
      </button>
    </form>
  );
}
