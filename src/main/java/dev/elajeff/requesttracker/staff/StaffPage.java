package dev.elajeff.requesttracker.staff;

import java.util.List;

public record StaffPage(List<SupportStaff> items, String nextCursor) {}
