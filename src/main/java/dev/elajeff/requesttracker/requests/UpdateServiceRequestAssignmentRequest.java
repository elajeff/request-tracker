package dev.elajeff.requesttracker.requests;

import java.util.UUID;
import jakarta.validation.constraints.AssertTrue;

public record UpdateServiceRequestAssignmentRequest(
        UUID staffId, Boolean unassign) {
    @AssertTrue(message = "Provide either staffId or unassign: true")
    public boolean isSelectionValid() {
        return (staffId != null && !Boolean.TRUE.equals(unassign))
                || (staffId == null && Boolean.TRUE.equals(unassign));
    }
}
