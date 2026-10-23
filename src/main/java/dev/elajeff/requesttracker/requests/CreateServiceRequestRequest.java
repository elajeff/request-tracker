package dev.elajeff.requesttracker.requests;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateServiceRequestRequest(
        @NotBlank(message = "must not be blank")
        @Size(max = 120, message = "must be at most 120 characters")
        String title,

        @NotBlank(message = "must not be blank")
        @Size(max = 2000, message = "must be at most 2000 characters")
        String description) {
}
