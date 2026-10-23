package dev.elajeff.requesttracker.requests;

import java.net.URI;
import java.util.List;
import java.util.UUID;

import jakarta.validation.Valid;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/requests")
public class ServiceRequestController {

    private final ServiceRequestService service;

    public ServiceRequestController(ServiceRequestService service) {
        this.service = service;
    }

    @PostMapping
    public ResponseEntity<ServiceRequest> create(
            @Valid @RequestBody CreateServiceRequestRequest request) {
        ServiceRequest created = service.create(
                request.title(), request.description(), request.priority());

        return ResponseEntity.created(
                URI.create("/api/requests/" + created.id()))
                .body(created);
    }

    @GetMapping
    public List<ServiceRequest> findAll() {
        return service.findAll();
    }

    @GetMapping("/{id}")
    public ServiceRequest findById(@PathVariable UUID id) {
        return service.findById(id);
    }

    @PatchMapping("/{id}/status")
    public ServiceRequest updateStatus(
            @PathVariable UUID id,
            @Valid @RequestBody UpdateServiceRequestStatusRequest request) {
        return service.updateStatus(id, request.status());
    }

    @PatchMapping("/{id}/priority")
    public ServiceRequest updatePriority(
            @PathVariable UUID id,
            @Valid @RequestBody UpdateServiceRequestPriorityRequest request) {
        return service.updatePriority(id, request.priority());
    }
}
