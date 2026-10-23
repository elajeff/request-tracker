package dev.elajeff.requesttracker.requests;

import java.time.Instant;
import java.util.UUID;

public record ServiceRequest(
        UUID id,
        String title,
        String description,
        ServiceRequestStatus status,
        Instant createdAt) {
}
