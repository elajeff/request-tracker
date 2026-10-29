package dev.elajeff.requesttracker.security;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AccountAdministration {
    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwords;

    public AccountAdministration(JdbcTemplate jdbc, PasswordEncoder passwords) {
        this.jdbc = jdbc;
        this.passwords = passwords;
    }

    @Transactional
    public void create(String username, String role, String password) {
        validateUsername(username);
        if (!"REQUESTER".equals(role) && !"SUPPORT".equals(role)) {
            throw new IllegalArgumentException("Role must be REQUESTER or SUPPORT");
        }
        if (password == null || password.length() < 12 || password.getBytes(StandardCharsets.UTF_8).length > 72) {
            throw new IllegalArgumentException("Password must contain at least 12 characters and at most 72 UTF-8 bytes");
        }
        if (jdbc.queryForObject("SELECT count(*) FROM login_accounts WHERE username = ?", Integer.class, username) != 0) {
            throw new IllegalArgumentException("Account already exists");
        }
        jdbc.update("INSERT INTO login_accounts (id, username, password_hash, role) VALUES (?, ?, ?, ?)",
                UUID.randomUUID(), username, passwords.encode(password), role);
    }

    @Transactional
    public void disable(String username) {
        validateUsername(username);
        if (jdbc.update("UPDATE login_accounts SET enabled = FALSE WHERE username = ?", username) != 1) {
            throw new IllegalArgumentException("Account not found");
        }
        jdbc.update("DELETE FROM spring_session WHERE principal_name = ?", username);
    }

    @Transactional
    public void claimLegacy(String username, UUID requestId) {
        validateUsername(username);
        var ids = jdbc.query("SELECT id FROM login_accounts WHERE username = ? AND role = 'REQUESTER' AND enabled FOR UPDATE",
                (row, n) -> row.getObject("id", UUID.class), username);
        if (ids.size() != 1) throw new IllegalArgumentException("Active requester account required");
        if (jdbc.update("UPDATE service_requests SET owner_id = ? WHERE id = ? AND owner_id IS NULL", ids.getFirst(), requestId) != 1) {
            throw new IllegalArgumentException("Ownerless request not found; existing ownership cannot be replaced");
        }
        // The local operator is not the target account; leave the actor unattributed.
        jdbc.update("INSERT INTO request_history (request_id, field, new_value) VALUES (?, 'OWNER', ?)",
                requestId, username + " [" + ids.getFirst() + "]");
    }

    private static void validateUsername(String username) {
        if (username == null || !username.matches("[a-z0-9][a-z0-9._-]{2,63}")) {
            throw new IllegalArgumentException("Username must be 3-64 lowercase letters, digits, dots, underscores or hyphens");
        }
    }
}
