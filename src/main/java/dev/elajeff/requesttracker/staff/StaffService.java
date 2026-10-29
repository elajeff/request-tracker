package dev.elajeff.requesttracker.staff;

import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
@org.springframework.security.access.prepost.PreAuthorize("hasRole('SUPPORT')")
public class StaffService {
    private final StaffRepository repository;

    public StaffService(StaffRepository repository) {
        this.repository = repository;
    }

    public SupportStaff create(String name) {
        return repository.create(name.strip());
    }

    public StaffPage findPage(String cursor, int limit) {
        if (limit < 1 || limit > 100) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Limit must be between 1 and 100");
        }
        UUID afterId = null;
        if (cursor != null) {
            try {
                afterId = UUID.fromString(cursor);
                if (!afterId.toString().equals(cursor)) throw new IllegalArgumentException();
            } catch (IllegalArgumentException error) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid staff cursor");
            }
        }
        List<SupportStaff> rows = repository.findPage(afterId, limit + 1);
        List<SupportStaff> items = List.copyOf(rows.subList(0, Math.min(limit, rows.size())));
        return new StaffPage(items, rows.size() > limit ? items.getLast().id().toString() : null);
    }

    @Transactional
    public SupportStaff rename(UUID id, String name) {
        requireForUpdate(id);
        return repository.rename(id, name.strip());
    }

    @Transactional
    public SupportStaff setActive(UUID id, boolean active) {
        SupportStaff current = requireForUpdate(id);
        if (active && current.name().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Rename blank legacy staff before activation");
        }
        return repository.setActive(id, active);
    }

    public SupportStaff requireForUpdate(UUID id) {
        return repository.findByIdForUpdate(id).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "Staff record not found"));
    }
}
