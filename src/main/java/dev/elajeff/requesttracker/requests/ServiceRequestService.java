package dev.elajeff.requesttracker.requests;

import java.util.List;
import java.util.Objects;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class ServiceRequestService {

    private final ServiceRequestRepository repository;

    public ServiceRequestService(ServiceRequestRepository repository) {
        this.repository = repository;
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

    public List<ServiceRequest> findAll() {
        return repository.findAll();
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
                current.status(), current.priority(), current.createdAt(), current.assignee());
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
                status, current.priority(), current.createdAt(), current.assignee());
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
                current.status(), priority, current.createdAt(), current.assignee());
    }

    @Transactional
    public ServiceRequest updateAssignment(UUID id, String assignee) {
        ServiceRequest current = findForUpdate(id);
        String selected = assignee.strip();
        if (selected.isEmpty()) selected = null;
        if (Objects.equals(current.assignee(), selected)) return current;
        repository.updateAssignment(id, selected);
        recordChange(id, "ASSIGNEE", current.assignee(), selected);
        return new ServiceRequest(current.id(), current.title(), current.description(),
                current.status(), current.priority(), current.createdAt(), selected);
    }

    public List<RequestHistoryEntry> findHistory(UUID id) {
        findById(id);
        return repository.findHistory(id);
    }

    private ServiceRequest findForUpdate(UUID id) {
        return repository.findByIdForUpdate(id)
                .orElseThrow(() -> new ServiceRequestNotFoundException(id));
    }

    private void recordChange(UUID id, String field, String before, String after) {
        if (!Objects.equals(before, after)) repository.recordChange(id, field, before, after);
    }
}
