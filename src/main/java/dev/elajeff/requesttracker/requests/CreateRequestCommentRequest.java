package dev.elajeff.requesttracker.requests;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateRequestCommentRequest(
        @NotBlank
        @Size(max = 2000, message = "must be at most 2000 characters")
        String body) {
}
