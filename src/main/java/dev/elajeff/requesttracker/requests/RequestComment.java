package dev.elajeff.requesttracker.requests;

import java.time.Instant;

public record RequestComment(long id, String body, Instant createdAt, String authorUsername) {
}
