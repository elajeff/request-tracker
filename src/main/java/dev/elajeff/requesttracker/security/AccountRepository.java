package dev.elajeff.requesttracker.security;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Repository;

@Repository
public class AccountRepository implements UserDetailsService {
    private static final RowMapper<Account> ROW_MAPPER = (row, n) -> new Account(row.getObject("id", UUID.class),
            row.getString("username"), AccountRole.valueOf(row.getString("role")), row.getBoolean("enabled"));

    private final JdbcTemplate jdbc;

    public AccountRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<Account> find(String username) {
        return jdbc.query("SELECT id, username, role, enabled FROM login_accounts WHERE username = ?",
                ROW_MAPPER, username).stream().findFirst();
    }

    public List<Account> findPage(String afterUsername, int limit, String query) {
        return jdbc.query("""
                SELECT id, username, role, enabled FROM login_accounts
                WHERE strpos(username, lower(?)) > 0 AND (?::varchar IS NULL OR username > ?)
                ORDER BY username LIMIT ?
                """, ROW_MAPPER, query, afterUsername, afterUsername, limit);
    }

    // Empty when the username is taken.
    public Optional<Account> insert(UUID id, String username, String passwordHash, AccountRole role) {
        return jdbc.query("""
                INSERT INTO login_accounts (id, username, password_hash, role) VALUES (?, ?, ?, ?)
                ON CONFLICT (username) DO NOTHING RETURNING id, username, role, enabled
                """, ROW_MAPPER, id, username, passwordHash, role.name()).stream().findFirst();
    }

    public Optional<Account> setEnabled(String username, boolean enabled) {
        return jdbc.query("UPDATE login_accounts SET enabled = ? WHERE username = ? RETURNING id, username, role, enabled",
                ROW_MAPPER, enabled, username).stream().findFirst();
    }

    public Optional<Account> setRole(String username, AccountRole role) {
        return jdbc.query("UPDATE login_accounts SET role = ? WHERE username = ? RETURNING id, username, role, enabled",
                ROW_MAPPER, role.name(), username).stream().findFirst();
    }

    public Optional<Account> setPasswordHash(String username, String passwordHash) {
        return jdbc.query("UPDATE login_accounts SET password_hash = ? WHERE username = ? RETURNING id, username, role, enabled",
                ROW_MAPPER, passwordHash, username).stream().findFirst();
    }

    public List<String> lockEnabledSupportUsernames() {
        return jdbc.queryForList("SELECT username FROM login_accounts WHERE role = 'SUPPORT' AND enabled ORDER BY id FOR UPDATE",
                String.class);
    }

    public Optional<UUID> lockActiveRequesterId(String username) {
        return jdbc.query("SELECT id FROM login_accounts WHERE username = ? AND role = 'REQUESTER' AND enabled FOR UPDATE",
                (row, n) -> row.getObject("id", UUID.class), username).stream().findFirst();
    }

    public void deleteSessions(String username) {
        jdbc.update("DELETE FROM spring_session WHERE principal_name = ?", username);
    }

    @Override
    public UserDetails loadUserByUsername(String username) {
        return jdbc.query("SELECT username, password_hash, role, enabled FROM login_accounts WHERE username = ?",
                (row, n) -> User.withUsername(row.getString("username"))
                        .password(row.getString("password_hash")).roles(row.getString("role"))
                        .disabled(!row.getBoolean("enabled")).build(), username).stream().findFirst()
                .orElseThrow(() -> new UsernameNotFoundException("Invalid credentials"));
    }
}
