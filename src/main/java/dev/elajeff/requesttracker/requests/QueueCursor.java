package dev.elajeff.requesttracker.requests;

import java.nio.charset.StandardCharsets;
import java.time.DateTimeException;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Position in the queue, ordered by (created_at, id) descending. Encoded as base64 "createdAt,id". */
record QueueCursor(Instant createdAt, UUID id) {
    // Instants outside this range cannot be stored as a PostgreSQL timestamp.
    private static final Instant MIN = Instant.parse("0001-01-01T00:00:00Z");
    private static final Instant MAX = Instant.parse("9999-12-31T23:59:59Z");

    static QueueCursor after(ServiceRequest request) {
        return new QueueCursor(request.createdAt(), request.id());
    }

    static QueueCursor decode(String value) {
        try {
            String[] parts = new String(Base64.getUrlDecoder().decode(value), StandardCharsets.UTF_8).split(",", -1);
            if (parts.length != 2) throw new IllegalArgumentException();
            Instant createdAt = Instant.parse(parts[0]);
            UUID id = UUID.fromString(parts[1]);
            if (createdAt.isBefore(MIN) || createdAt.isAfter(MAX) || !id.toString().equals(parts[1])) {
                throw new IllegalArgumentException();
            }
            return new QueueCursor(createdAt, id);
        } catch (IllegalArgumentException | DateTimeException error) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid queue cursor");
        }
    }

    String encode() {
        return Base64.getUrlEncoder().withoutPadding()
                .encodeToString((createdAt + "," + id).getBytes(StandardCharsets.UTF_8));
    }
}
