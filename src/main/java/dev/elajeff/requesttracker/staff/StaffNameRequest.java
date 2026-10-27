package dev.elajeff.requesttracker.staff;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record StaffNameRequest(@NotBlank @Size(max = 120) String name) {}
