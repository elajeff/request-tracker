package dev.elajeff.requesttracker.requests;

import java.util.List;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.DateTimeException;
import java.util.Base64;
import java.util.Objects;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import dev.elajeff.requesttracker.staff.StaffService;
import dev.elajeff.requesttracker.staff.SupportStaff;

@Service
public class ServiceRequestService {

    private final ServiceRequestRepository repository;
    private final StaffService staffService;

    public ServiceRequestService(ServiceRequestRepository repository, StaffService staffService) {
        this.repository = repository;
        this.staffService = staffService;
    }

    @Transactional
    public ServiceRequest create(
            String title, String description, ServiceRequestPriority priority) {
        ServiceRequestPriority selectedPriority =
                priority == null ? ServiceRequestPriority.MEDIUM : priority;

        ServiceRequest created = repository.create(title.strip(), description.strip(), selectedPriority);
        repository.recordChange(created.id(), "CREATED", null, created.title());
        return created;
    }

    public RequestQueuePage findPage(String query, String cursor, int limit, UUID staffId, boolean unassigned) {
        validateLimit(limit);
        if (staffId != null && unassigned) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose staffId or unassigned, not both");
        }
        Instant beforeCreatedAt = null;
        UUID beforeId = null;
        if (cursor != null) {
            try {
                if (cursor.length() > 256) throw new IllegalArgumentException();
                String[] parts = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8).split(",", -1);
                if (parts.length != 2) throw new IllegalArgumentException();
                beforeCreatedAt = Instant.parse(parts[0]);
                if (beforeCreatedAt.isBefore(Instant.parse("0001-01-01T00:00:00Z"))
                        || beforeCreatedAt.isAfter(Instant.parse("9999-12-31T23:59:59Z"))) {
                    throw new IllegalArgumentException();
                }
                beforeId = UUID.fromString(parts[1]);
                if (!beforeId.toString().equals(parts[1])) throw new IllegalArgumentException();
            } catch (IllegalArgumentException | DateTimeException error) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid queue cursor");
            }
        }
        List<ServiceRequest> rows = repository.findPage(query.strip(), staffId, unassigned, beforeCreatedAt, beforeId, limit + 1);
        boolean hasMore = rows.size() > limit;
        List<ServiceRequest> items = List.copyOf(rows.subList(0, Math.min(limit, rows.size())));
        String nextCursor = null;
        if (hasMore) {
            ServiceRequest last = items.getLast();
            nextCursor = Base64.getUrlEncoder().withoutPadding().encodeToString(
                    (last.createdAt() + "," + last.id()).getBytes(StandardCharsets.UTF_8));
        }
        return new RequestQueuePage(items, nextCursor, repository.counts());
    }

    public ServiceRequest findById(UUID id) {
        return repository.findById(id)
                .orElseThrow(() -> new ServiceRequestNotFoundException(id));
    }

    @Transactional
    public ServiceRequest updateDetails(UUID id, String title, String description) {
        ServiceRequest current = findForUpdate(id);
        String updatedTitle = title.strip();
        String updatedDescription = description.strip();

        if (current.title().equals(updatedTitle)
                && current.description().equals(updatedDescription)) {
            return current;
        }

        if (!repository.updateDetails(id, updatedTitle, updatedDescription)) {
            throw new ServiceRequestNotFoundException(id);
        }

        recordChange(id, "TITLE", current.title(), updatedTitle);
        recordChange(id, "DESCRIPTION", current.description(), updatedDescription);
        return new ServiceRequest(
                current.id(), updatedTitle, updatedDescription,
                current.status(), current.priority(), current.createdAt(), current.assignee(), current.assigneeId(), current.assigneeActive());
    }

    @Transactional
    public ServiceRequest updateStatus(UUID id, ServiceRequestStatus status) {
        ServiceRequest current = findForUpdate(id);

        if (current.status() == status) {
            return current;
        }

        boolean allowed = switch (current.status()) {
            case NEW -> status == ServiceRequestStatus.IN_PROGRESS;
            case IN_PROGRESS -> status == ServiceRequestStatus.RESOLVED;
            case RESOLVED -> false;
        };

        if (!allowed) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Cannot change status from " + current.status() + " to " + status);
        }

        if (!repository.updateStatus(id, current.status(), status)) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "Request status changed. Refresh and try again.");
        }

        recordChange(id, "STATUS", current.status().name(), status.name());
        return new ServiceRequest(
                current.id(), current.title(), current.description(),
                status, current.priority(), current.createdAt(), current.assignee(), current.assigneeId(), current.assigneeActive());
    }

    @Transactional
    public ServiceRequest updatePriority(UUID id, ServiceRequestPriority priority) {
        ServiceRequest current = findForUpdate(id);

        if (current.priority() == priority) {
            return current;
        }

        if (!repository.updatePriority(id, priority)) {
            throw new ServiceRequestNotFoundException(id);
        }

        recordChange(id, "PRIORITY", current.priority().name(), priority.name());
        return new ServiceRequest(
                current.id(), current.title(), current.description(),
                current.status(), priority, current.createdAt(), current.assignee(), current.assigneeId(), current.assigneeActive());
    }

    @Transactional
    public ServiceRequest updateAssignment(UUID id, UUID staffId) {
        ServiceRequest current = findForUpdate(id);
        if (Objects.equals(current.assigneeId(), staffId)) return current;
        SupportStaff selected = null;
        if (staffId != null) {
            // Serialize assignment with deactivation/renaming of its target staff record.
            selected = staffService.requireForUpdate(staffId);
            if (!selected.active()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Cannot assign inactive staff");
            }
        }
        repository.updateAssignment(id, staffId);
        recordChange(id, "ASSIGNEE", assignmentLabel(current.assignee(), current.assigneeId()),
                selected == null ? null : assignmentLabel(selected.name(), selected.id()));
        return findById(id);
    }

    private static String assignmentLabel(String name, UUID id) {
        return id == null ? null : name + " [" + id + "]";
    }

    public RequestHistoryPage findHistory(UUID id, String cursor, int limit) {
        validateLimit(limit);
        Long beforeId = null;
        if (cursor != null) {
            try {
                beforeId = Long.valueOf(cursor);
                if (beforeId <= 0) throw new NumberFormatException();
            } catch (NumberFormatException error) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid history cursor");
            }
        }
        findById(id);
        List<RequestHistoryEntry> rows = repository.findHistory(id, beforeId, limit + 1);
        boolean hasMore = rows.size() > limit;
        List<RequestHistoryEntry> items = List.copyOf(rows.subList(0, Math.min(limit, rows.size())));
        return new RequestHistoryPage(items, hasMore ? Long.toString(items.getLast().id()) : null);
    }

    private static void validateLimit(int limit) {
        if (limit < 1 || limit > 100) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Limit must be between 1 and 100");
        }
    }

    private ServiceRequest findForUpdate(UUID id) {
        return repository.findByIdForUpdate(id)
                .orElseThrow(() -> new ServiceRequestNotFoundException(id));
    }

    private void recordChange(UUID id, String field, String before, String after) {
        if (!Objects.equals(before, after)) repository.recordChange(id, field, before, after);
    }
}
