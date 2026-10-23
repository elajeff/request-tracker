package dev.elajeff.requesttracker.requests;

import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Service;

@Service
public class ServiceRequestService {

    private final ServiceRequestRepository repository;

    public ServiceRequestService(ServiceRequestRepository repository) {
        this.repository = repository;
    }

    public ServiceRequest create(String title, String description) {
        return repository.create(title.strip(), description.strip());
    }

    public List<ServiceRequest> findAll() {
        return repository.findAll();
    }

    public ServiceRequest findById(UUID id) {
        return repository.findById(id)
                .orElseThrow(() -> new ServiceRequestNotFoundException(id));
    }
}
