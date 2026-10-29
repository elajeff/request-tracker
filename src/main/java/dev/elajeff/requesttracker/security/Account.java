package dev.elajeff.requesttracker.security;

import java.util.UUID;

public record Account(UUID id, String username, String role, boolean enabled) {
    public boolean support() {
        return role.equals("SUPPORT");
    }
}
