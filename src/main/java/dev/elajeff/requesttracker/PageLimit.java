package dev.elajeff.requesttracker;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

public final class PageLimit {
    private PageLimit() {
    }

    public static void validate(int limit) {
        if (limit < 1 || limit > 100) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Limit must be between 1 and 100");
        }
    }
}
