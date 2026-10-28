package dev.elajeff.requesttracker.staff;

import jakarta.validation.constraints.NotNull;

public record StaffActiveRequest(@NotNull Boolean active) {}
