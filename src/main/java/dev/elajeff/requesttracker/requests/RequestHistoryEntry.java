package dev.elajeff.requesttracker.requests;

import java.time.Instant;

public record RequestHistoryEntry(
        long id, String field, String oldValue, String newValue, Instant changedAt, String actorUsername) {
}
