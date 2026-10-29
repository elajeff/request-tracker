package dev.elajeff.requesttracker.security;

import org.springframework.security.core.Authentication;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class SessionController {
    private final CurrentAccount current;

    public SessionController(CurrentAccount current) {
        this.current = current;
    }

    @GetMapping("/api/session")
    SessionView session(Authentication authentication, CsrfToken csrf) {
        return new SessionView(authentication == null ? null : current.required(), csrf.getToken(), csrf.getHeaderName());
    }

    record SessionView(Account user, String csrfToken, String csrfHeaderName) {}
}
