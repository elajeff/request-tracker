package dev.elajeff.requesttracker.requests;

import java.net.URI;
import java.util.UUID;

import jakarta.validation.Valid;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
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
    public RequestQueuePage findAll(
            @RequestParam(defaultValue = "") String q,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "25") int limit) {
        return service.findPage(q, cursor, limit);
    }

    @GetMapping("/{id}")
    public ServiceRequest findById(@PathVariable UUID id) {
        return service.findById(id);
    }

    @PutMapping("/{id}")
    public ServiceRequest updateDetails(
            @PathVariable UUID id,
            @Valid @RequestBody UpdateServiceRequestDetailsRequest request) {
        return service.updateDetails(id, request.title(), request.description());
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

    @PatchMapping("/{id}/assignment")
    public ServiceRequest updateAssignment(
            @PathVariable UUID id,
            @Valid @RequestBody UpdateServiceRequestAssignmentRequest request) {
        return service.updateAssignment(id, request.assignee());
    }

    @GetMapping("/{id}/history")
    public RequestHistoryPage findHistory(@PathVariable UUID id,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "25") int limit) {
        return service.findHistory(id, cursor, limit);
    }
}
