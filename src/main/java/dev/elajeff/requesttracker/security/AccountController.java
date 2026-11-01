package dev.elajeff.requesttracker.security;

import java.net.URI;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

// Field rules live in AccountAdministration, which the command line uses too.
@RestController
@RequestMapping("/api/accounts")
public class AccountController {
    private final AccountAdministration administration;

    public AccountController(AccountAdministration administration) {
        this.administration = administration;
    }

    @GetMapping
    public AccountPage findPage(@RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "25") int limit,
            @RequestParam(defaultValue = "") String q) {
        return administration.findPage(cursor, limit, q);
    }

    @PostMapping
    public ResponseEntity<Account> create(@RequestBody CreateRequest request) {
        Account created = administration.create(request.username(), request.role(), request.password());
        return ResponseEntity.created(URI.create("/api/accounts/" + created.username())).body(created);
    }

    @PatchMapping("/{username}/enabled")
    public Account setEnabled(@PathVariable String username, @Valid @RequestBody EnabledRequest request) {
        return administration.setEnabled(username, request.enabled());
    }

    @PatchMapping("/{username}/role")
    public Account changeRole(@PathVariable String username, @RequestBody RoleRequest request) {
        return administration.changeRole(username, request.role());
    }

    @PutMapping("/{username}/password")
    public ResponseEntity<Void> resetPassword(@PathVariable String username, @RequestBody PasswordRequest request) {
        administration.resetPassword(username, request.password());
        return ResponseEntity.noContent().build();
    }

    record CreateRequest(String username, String role, String password) {}

    record EnabledRequest(@NotNull Boolean enabled) {}

    record RoleRequest(String role) {}

    record PasswordRequest(String password) {}
}
