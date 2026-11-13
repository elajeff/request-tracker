package dev.elajeff.requesttracker.security;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Stream;

import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import dev.elajeff.requesttracker.PageLimit;
import dev.elajeff.requesttracker.requests.ServiceRequestRepository;

// Shared by the admin API and the command line, so both apply the same rules.
@Service
public class AccountAdministration {
    private final PasswordEncoder passwords;
    private final AccountRepository accounts;
    private final ServiceRequestRepository requests;

    public AccountAdministration(PasswordEncoder passwords, AccountRepository accounts, ServiceRequestRepository requests) {
        this.passwords = passwords;
        this.accounts = accounts;
        this.requests = requests;
    }

    public AccountPage findPage(String cursor, int limit, String query) {
        PageLimit.validate(limit);
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
        AccountRole accountRole = parseRole(role);
        validatePassword(password);
        return accounts.insert(UUID.randomUUID(), username, passwords.encode(password), accountRole).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.CONFLICT, "Account already exists"));
    }

    @Transactional
    public Account setEnabled(String username, boolean enabled) {
        validateUsername(username);
        if (!enabled) keepOneSupport(username);
        Account account = found(accounts.setEnabled(username, enabled));
        if (!enabled) accounts.deleteSessions(username);
        return account;
    }

    @Transactional
    public Account changeRole(String username, String role) {
        validateUsername(username);
        AccountRole newRole = parseRole(role);
        Account current = found(accounts.find(username));
        if (current.role() == newRole) return current;
        if (newRole == AccountRole.REQUESTER) keepOneSupport(username);
        Account account = found(accounts.setRole(username, newRole));
        // A session keeps the role it logged in with, so it has to end.
        accounts.deleteSessions(username);
        return account;
    }

    @Transactional
    public void resetPassword(String username, String password) {
        validateUsername(username);
        validatePassword(password);
        found(accounts.setPasswordHash(username, passwords.encode(password)));
        accounts.deleteSessions(username);
    }

    @Transactional
    public void claimLegacy(String username, UUID requestId) {
        validateUsername(username);
        UUID ownerId = accounts.lockActiveRequesterId(username).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.BAD_REQUEST, "Active requester account required"));
        if (!requests.setOwnerIfNone(requestId, ownerId)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Ownerless request not found; existing ownership cannot be replaced");
        }
        // The local operator is not the target account; leave the actor unattributed.
        requests.recordChange(requestId, "OWNER", null, username + " [" + ownerId + "]", null, null);
    }

    // Lock every enabled SUPPORT row first, so two people removing each other at the same time cannot both succeed.
    private void keepOneSupport(String username) {
        var support = accounts.lockEnabledSupportUsernames();
        if (support.equals(List.of(username))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "At least one active SUPPORT account is required");
        }
    }

    private static Account found(Optional<Account> account) {
        return account.orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Account not found"));
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

    private static AccountRole parseRole(String role) {
        return Stream.of(AccountRole.values()).filter(candidate -> candidate.name().equals(role)).findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Role must be REQUESTER or SUPPORT"));
    }

    private static void validatePassword(String password) {
        if (password == null || password.length() < 12 || password.getBytes(StandardCharsets.UTF_8).length > 72) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Password must contain at least 12 characters and at most 72 UTF-8 bytes");
        }
    }
}
