package dev.elajeff.requesttracker.requests;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record UpdateServiceRequestAssignmentRequest(
        @NotNull @Size(max = 120) String assignee) {
}
