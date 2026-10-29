package dev.elajeff.requesttracker.security;

import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Repository;

@Repository
public class AccountRepository implements UserDetailsService {
    private final JdbcTemplate jdbc;

    public AccountRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<Account> find(String username) {
        return jdbc.query("SELECT id, username, role, enabled FROM login_accounts WHERE username = ?",
                (row, n) -> new Account(row.getObject("id", UUID.class), row.getString("username"),
                        row.getString("role"), row.getBoolean("enabled")), username).stream().findFirst();
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
