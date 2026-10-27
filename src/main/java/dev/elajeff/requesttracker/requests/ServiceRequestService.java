package dev.elajeff.requesttracker.requests;

import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class ServiceRequestService {

    private final ServiceRequestRepository repository;

    public ServiceRequestService(ServiceRequestRepository repository) {
        this.repository = repository;
    }

    public ServiceRequest create(
            String title, String description, ServiceRequestPriority priority) {
        ServiceRequestPriority selectedPriority =
                priority == null ? ServiceRequestPriority.MEDIUM : priority;

        return repository.create(title.strip(), description.strip(), selectedPriority);
    }

    public List<ServiceRequest> findAll() {
        return repository.findAll();
    }

    public ServiceRequest findById(UUID id) {
        return repository.findById(id)
                .orElseThrow(() -> new ServiceRequestNotFoundException(id));
    }

    public ServiceRequest updateDetails(UUID id, String title, String description) {
        ServiceRequest current = findById(id);
        String updatedTitle = title.strip();
        String updatedDescription = description.strip();

        if (current.title().equals(updatedTitle)
                && current.description().equals(updatedDescription)) {
            return current;
        }

        if (!repository.updateDetails(id, updatedTitle, updatedDescription)) {
            throw new ServiceRequestNotFoundException(id);
        }

        return new ServiceRequest(
                current.id(), updatedTitle, updatedDescription,
                current.status(), current.priority(), current.createdAt());
    }

    public ServiceRequest updateStatus(UUID id, ServiceRequestStatus status) {
        ServiceRequest current = findById(id);

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

        return new ServiceRequest(
                current.id(), current.title(), current.description(),
                status, current.priority(), current.createdAt());
    }

    public ServiceRequest updatePriority(UUID id, ServiceRequestPriority priority) {
        ServiceRequest current = findById(id);

        if (current.priority() == priority) {
            return current;
        }

        if (!repository.updatePriority(id, priority)) {
            throw new ServiceRequestNotFoundException(id);
        }

        return new ServiceRequest(
                current.id(), current.title(), current.description(),
                current.status(), priority, current.createdAt());
    }
}
