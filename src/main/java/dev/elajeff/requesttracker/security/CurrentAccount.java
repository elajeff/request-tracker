package dev.elajeff.requesttracker.security;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.server.ResponseStatusException;

@Component
public class CurrentAccount {
    static final String REQUEST_ATTRIBUTE = CurrentAccount.class.getName();

    private final AccountRepository accounts;

    public CurrentAccount(AccountRepository accounts) {
        this.accounts = accounts;
    }

    public Account required() {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        // The API filter has already loaded the account for this request; outside a request, load it here.
        var request = RequestContextHolder.getRequestAttributes();
        if (request != null && request.getAttribute(REQUEST_ATTRIBUTE, RequestAttributes.SCOPE_REQUEST) instanceof Account account
                && account.username().equals(authentication.getName())) {
            return account;
        }
        return accounts.find(authentication.getName()).filter(Account::enabled)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
    }
}
