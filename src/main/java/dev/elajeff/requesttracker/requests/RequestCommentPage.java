package dev.elajeff.requesttracker.requests;

import java.util.List;

public record RequestCommentPage(List<RequestComment> items, String nextCursor) {}
