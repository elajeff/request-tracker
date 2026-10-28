package dev.elajeff.requesttracker.requests;

import java.util.List;

public record RequestHistoryPage(List<RequestHistoryEntry> items, String nextCursor) {}
