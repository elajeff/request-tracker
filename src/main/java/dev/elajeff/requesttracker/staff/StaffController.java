package dev.elajeff.requesttracker.staff;

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
@RequestMapping("/api/staff")
public class StaffController {
    private final StaffService service;

    public StaffController(StaffService service) {
        this.service = service;
    }

    @GetMapping
    public StaffPage findPage(@RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "25") int limit) {
        return service.findPage(cursor, limit);
    }

    @PostMapping
    public ResponseEntity<SupportStaff> create(@Valid @RequestBody StaffNameRequest request) {
        SupportStaff created = service.create(request.name());
        return ResponseEntity.created(URI.create("/api/staff/" + created.id())).body(created);
    }

    @PutMapping("/{id}")
    public SupportStaff rename(@PathVariable UUID id, @Valid @RequestBody StaffNameRequest request) {
        return service.rename(id, request.name());
    }

    @PatchMapping("/{id}/active")
    public SupportStaff setActive(@PathVariable UUID id, @Valid @RequestBody StaffActiveRequest request) {
        return service.setActive(id, request.active());
    }
}
