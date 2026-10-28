package dev.elajeff.requesttracker.requests;

import java.util.List;

public record RequestQueuePage(List<ServiceRequest> items, String nextCursor, Counts counts) {
    public record Counts(long total, long newCount, long inProgressCount, long resolvedCount) {}
}
