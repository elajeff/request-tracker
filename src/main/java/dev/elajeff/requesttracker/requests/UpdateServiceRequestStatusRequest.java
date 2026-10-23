package dev.elajeff.requesttracker.requests;

import jakarta.validation.constraints.NotNull;

public record UpdateServiceRequestStatusRequest(
        @NotNull(message = "status is required")
        ServiceRequestStatus status) {
}
