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
    static final RowMapper<Account> ROW_MAPPER = (row, n) -> new Account(row.getObject("id", UUID.class),
            row.getString("username"), row.getString("role"), row.getBoolean("enabled"));

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
    public Optional<Account> insert(UUID id, String username, String passwordHash, String role) {
        return jdbc.query("""
                INSERT INTO login_accounts (id, username, password_hash, role) VALUES (?, ?, ?, ?)
                ON CONFLICT (username) DO NOTHING RETURNING id, username, role, enabled
                """, ROW_MAPPER, id, username, passwordHash, role).stream().findFirst();
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
