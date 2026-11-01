package dev.elajeff.requesttracker.requests;

import java.util.List;
import java.util.Objects;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import dev.elajeff.requesttracker.security.Account;
import dev.elajeff.requesttracker.security.CurrentAccount;
import dev.elajeff.requesttracker.staff.StaffService;
import dev.elajeff.requesttracker.staff.SupportStaff;

@Service
public class ServiceRequestService {

    private final ServiceRequestRepository repository;
    private final StaffService staffService;
    private final CurrentAccount currentAccount;

    public ServiceRequestService(ServiceRequestRepository repository, StaffService staffService, CurrentAccount currentAccount) {
        this.repository = repository;
        this.staffService = staffService;
        this.currentAccount = currentAccount;
    }

    @Transactional
    public ServiceRequest create(String title, String description, ServiceRequestPriority priority) {
        ServiceRequestPriority selectedPriority = priority == null ? ServiceRequestPriority.MEDIUM : priority;
        Account account = currentAccount.required();
        if (!account.support() && selectedPriority != ServiceRequestPriority.MEDIUM) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only support may set priority");
        }
        ServiceRequest created = repository.create(title.strip(), description.strip(), selectedPriority, account.id());
        recordChange(account, created.id(), "CREATED", null, created.title());
        return created;
    }

    public RequestQueuePage findPage(String query, String cursor, int limit, UUID staffId, boolean unassigned, ServiceRequestStatus status) {
        validateLimit(limit);
        if (staffId != null && unassigned) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose staffId or unassigned, not both");
        }
        QueueCursor after = cursor == null ? null : QueueCursor.decode(cursor);
        UUID owner = ownerScope(currentAccount.required());
        List<ServiceRequest> rows = repository.findPage(query.strip(), staffId, unassigned, status, after, limit + 1, owner);
        List<ServiceRequest> items = List.copyOf(rows.subList(0, Math.min(limit, rows.size())));
        String nextCursor = rows.size() > limit ? QueueCursor.after(items.getLast()).encode() : null;
        return new RequestQueuePage(items, nextCursor, repository.counts(owner));
    }

    public ServiceRequest findById(UUID id) {
        return findVisible(currentAccount.required(), id);
    }

    @Transactional
    public ServiceRequest updateDetails(UUID id, String title, String description) {
        Account account = currentAccount.required();
        ServiceRequest current = findForUpdate(account, id);
        if (!account.support() && current.status() != ServiceRequestStatus.NEW) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Requesters may edit details only while a request is NEW");
        }
        String newTitle = title.strip();
        String newDescription = description.strip();
        if (current.title().equals(newTitle) && current.description().equals(newDescription)) {
            return current;
        }
        repository.updateDetails(id, newTitle, newDescription);
        recordChange(account, id, "TITLE", current.title(), newTitle);
        recordChange(account, id, "DESCRIPTION", current.description(), newDescription);
        return findVisible(account, id);
    }

    @Transactional
    public ServiceRequest updateStatus(UUID id, ServiceRequestStatus status) {
        Account account = currentAccount.required();
        ServiceRequest current = findForUpdate(account, id);
        if (current.status() == status) {
            return current;
        }
        boolean allowed = switch (current.status()) {
            case NEW -> status == ServiceRequestStatus.IN_PROGRESS;
            case IN_PROGRESS -> status == ServiceRequestStatus.RESOLVED;
            case RESOLVED -> false;
        };
        if (!allowed) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Cannot change status from " + current.status() + " to " + status);
        }
        repository.updateStatus(id, status);
        recordChange(account, id, "STATUS", current.status().name(), status.name());
        return findVisible(account, id);
    }

    @Transactional
    public ServiceRequest updatePriority(UUID id, ServiceRequestPriority priority) {
        Account account = currentAccount.required();
        ServiceRequest current = findForUpdate(account, id);
        if (current.priority() == priority) {
            return current;
        }
        repository.updatePriority(id, priority);
        recordChange(account, id, "PRIORITY", current.priority().name(), priority.name());
        return findVisible(account, id);
    }

    @Transactional
    public ServiceRequest updateAssignment(UUID id, UUID staffId) {
        Account account = currentAccount.required();
        ServiceRequest current = findForUpdate(account, id);
        if (Objects.equals(current.assigneeId(), staffId)) {
            return current;
        }
        SupportStaff selected = null;
        if (staffId != null) {
            // Lock the staff row so it cannot be deactivated or renamed while being assigned.
            selected = staffService.requireForUpdate(staffId);
            if (!selected.active()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Cannot assign inactive staff");
            }
        }
        repository.updateAssignment(id, staffId);
        recordChange(account, id, "ASSIGNEE", assignmentLabel(current.assignee(), current.assigneeId()),
                selected == null ? null : assignmentLabel(selected.name(), selected.id()));
        return findVisible(account, id);
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
        List<RequestHistoryEntry> items = List.copyOf(rows.subList(0, Math.min(limit, rows.size())));
        return new RequestHistoryPage(items, rows.size() > limit ? Long.toString(items.getLast().id()) : null);
    }

    private static String assignmentLabel(String name, UUID id) {
        return id == null ? null : name + " [" + id + "]";
    }

    private static void validateLimit(int limit) {
        if (limit < 1 || limit > 100) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Limit must be between 1 and 100");
        }
    }

    /** Requesters only see their own requests; support sees all of them. */
    private static UUID ownerScope(Account account) {
        return account.support() ? null : account.id();
    }

    private ServiceRequest findVisible(Account account, UUID id) {
        return repository.findById(id, ownerScope(account))
                .orElseThrow(() -> new ServiceRequestNotFoundException(id));
    }

    private ServiceRequest findForUpdate(Account account, UUID id) {
        return repository.findByIdForUpdate(id, ownerScope(account))
                .orElseThrow(() -> new ServiceRequestNotFoundException(id));
    }

    private void recordChange(Account actor, UUID id, String field, String before, String after) {
        if (!Objects.equals(before, after)) {
            repository.recordChange(id, field, before, after, actor.id(), actor.username());
        }
    }
}
