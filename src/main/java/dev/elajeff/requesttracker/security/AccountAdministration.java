package dev.elajeff.requesttracker.security;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

// Shared by the admin API and the command line, so both apply the same rules.
@Service
public class AccountAdministration {
    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwords;
    private final AccountRepository accounts;

    public AccountAdministration(JdbcTemplate jdbc, PasswordEncoder passwords, AccountRepository accounts) {
        this.jdbc = jdbc;
        this.passwords = passwords;
        this.accounts = accounts;
    }

    public AccountPage findPage(String cursor, int limit, String query) {
        if (limit < 1 || limit > 100) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Limit must be between 1 and 100");
        }
        if (cursor != null && !validUsername(cursor)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid account cursor");
        }
        List<Account> rows = accounts.findPage(cursor, limit + 1, query.strip());
        List<Account> items = List.copyOf(rows.subList(0, Math.min(limit, rows.size())));
        return new AccountPage(items, rows.size() > limit ? items.getLast().username() : null);
    }

    @Transactional
    public Account create(String username, String role, String password) {
        validateUsername(username);
        validateRole(role);
        validatePassword(password);
        return accounts.insert(UUID.randomUUID(), username, passwords.encode(password), role).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.CONFLICT, "Account already exists"));
    }

    @Transactional
    public Account setEnabled(String username, boolean enabled) {
        validateUsername(username);
        if (!enabled) keepOneSupport(username);
        Account account = update(username, "enabled", enabled);
        if (!enabled) endSessions(username);
        return account;
    }

    @Transactional
    public Account changeRole(String username, String role) {
        validateUsername(username);
        validateRole(role);
        Account current = accounts.find(username).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "Account not found"));
        if (current.role().equals(role)) return current;
        if (role.equals("REQUESTER")) keepOneSupport(username);
        Account account = update(username, "role", role);
        // A session keeps the role it logged in with, so it has to end.
        endSessions(username);
        return account;
    }

    @Transactional
    public void resetPassword(String username, String password) {
        validateUsername(username);
        validatePassword(password);
        update(username, "password_hash", passwords.encode(password));
        endSessions(username);
    }

    @Transactional
    public void claimLegacy(String username, UUID requestId) {
        validateUsername(username);
        var ids = jdbc.query("SELECT id FROM login_accounts WHERE username = ? AND role = 'REQUESTER' AND enabled FOR UPDATE",
                (row, n) -> row.getObject("id", UUID.class), username);
        if (ids.size() != 1) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Active requester account required");
        if (jdbc.update("UPDATE service_requests SET owner_id = ? WHERE id = ? AND owner_id IS NULL", ids.getFirst(), requestId) != 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Ownerless request not found; existing ownership cannot be replaced");
        }
        // The local operator is not the target account; leave the actor unattributed.
        jdbc.update("INSERT INTO request_history (request_id, field, new_value) VALUES (?, 'OWNER', ?)",
                requestId, username + " [" + ids.getFirst() + "]");
    }

    // Lock every enabled SUPPORT row first, so two people removing each other at the same time cannot both succeed.
    private void keepOneSupport(String username) {
        var support = jdbc.queryForList("SELECT username FROM login_accounts WHERE role = 'SUPPORT' AND enabled ORDER BY id FOR UPDATE",
                String.class);
        if (support.equals(List.of(username))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "At least one active SUPPORT account is required");
        }
    }

    private Account update(String username, String column, Object value) {
        return jdbc.query("UPDATE login_accounts SET " + column + " = ? WHERE username = ? RETURNING id, username, role, enabled",
                AccountRepository.ROW_MAPPER, value, username).stream().findFirst().orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "Account not found"));
    }

    private void endSessions(String username) {
        jdbc.update("DELETE FROM spring_session WHERE principal_name = ?", username);
    }

    private static void validateUsername(String username) {
        if (!validUsername(username)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Username must be 3-64 lowercase letters, digits, dots, underscores or hyphens");
        }
    }

    private static boolean validUsername(String username) {
        return username != null && username.matches("[a-z0-9][a-z0-9._-]{2,63}");
    }

    private static void validateRole(String role) {
        if (!"REQUESTER".equals(role) && !"SUPPORT".equals(role)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Role must be REQUESTER or SUPPORT");
        }
    }

    private static void validatePassword(String password) {
        if (password == null || password.length() < 12 || password.getBytes(StandardCharsets.UTF_8).length > 72) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Password must contain at least 12 characters and at most 72 UTF-8 bytes");
        }
    }
}
