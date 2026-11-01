package dev.elajeff.requesttracker.security;

import java.util.List;

public record AccountPage(List<Account> items, String nextCursor) {}
