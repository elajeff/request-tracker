package dev.elajeff.requesttracker.requests;

import jakarta.validation.constraints.NotNull;

public record UpdateServiceRequestPriorityRequest(
        @NotNull(message = "priority is required")
        ServiceRequestPriority priority) {
}
