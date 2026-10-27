package dev.elajeff.requesttracker.requests;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
public class ServiceRequestRepository {

    private static final RowMapper<ServiceRequest> ROW_MAPPER =
            ServiceRequestRepository::mapRow;

    private final JdbcTemplate jdbcTemplate;

    public ServiceRequestRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public ServiceRequest create(
            String title, String description, ServiceRequestPriority priority) {
        UUID id = UUID.randomUUID();

        return jdbcTemplate.queryForObject("""
                INSERT INTO service_requests
                    (id, title, description, status, priority)
                VALUES (?, ?, ?, ?, ?)
                RETURNING id, title, description, status, priority, created_at, assignee
                """,
                ROW_MAPPER,
                id,
                title,
                description,
                ServiceRequestStatus.NEW.name(),
                priority.name());
    }

    public boolean updateDetails(UUID id, String title, String description) {
        return jdbcTemplate.update("""
                UPDATE service_requests
                SET title = ?, description = ?
                WHERE id = ?
                """, title, description, id) == 1;
    }

    public boolean updateStatus(UUID id, ServiceRequestStatus expected, ServiceRequestStatus status) {
        return jdbcTemplate.update("""
                UPDATE service_requests
                SET status = ?
                WHERE id = ? AND status = ?
                """, status.name(), id, expected.name()) == 1;
    }

    public boolean updatePriority(UUID id, ServiceRequestPriority priority) {
        return jdbcTemplate.update("""
                UPDATE service_requests
                SET priority = ?
                WHERE id = ?
                """, priority.name(), id) == 1;
    }

    public List<ServiceRequest> findAll() {
        return jdbcTemplate.query("""
                SELECT id, title, description, status, priority, created_at, assignee
                FROM service_requests
                ORDER BY created_at DESC, id DESC
                """, ROW_MAPPER);
    }

    public Optional<ServiceRequest> findById(UUID id) {
        List<ServiceRequest> matches = jdbcTemplate.query("""
                SELECT id, title, description, status, priority, created_at, assignee
                FROM service_requests
                WHERE id = ?
                """, ROW_MAPPER, id);

        return matches.stream().findFirst();
    }

    public Optional<ServiceRequest> findByIdForUpdate(UUID id) {
        return jdbcTemplate.query("SELECT * FROM service_requests WHERE id = ? FOR UPDATE",
                ROW_MAPPER, id).stream().findFirst();
    }

    public void updateAssignment(UUID id, String assignee) {
        jdbcTemplate.update("UPDATE service_requests SET assignee = ? WHERE id = ?", assignee, id);
    }

    public void recordChange(UUID id, String field, String oldValue, String newValue) {
        jdbcTemplate.update("""
                INSERT INTO request_history (request_id, field, old_value, new_value)
                VALUES (?, ?, ?, ?)
                """, id, field, oldValue, newValue);
    }

    public List<RequestHistoryEntry> findHistory(UUID id) {
        return jdbcTemplate.query("""
                SELECT id, field, old_value, new_value, changed_at
                FROM request_history WHERE request_id = ? ORDER BY id DESC
                """, (row, number) -> new RequestHistoryEntry(row.getLong("id"),
                row.getString("field"), row.getString("old_value"), row.getString("new_value"),
                row.getTimestamp("changed_at").toInstant()), id);
    }

    private static ServiceRequest mapRow(ResultSet resultSet, int rowNumber)
            throws SQLException {
        return new ServiceRequest(
                resultSet.getObject("id", UUID.class),
                resultSet.getString("title"),
                resultSet.getString("description"),
                ServiceRequestStatus.valueOf(resultSet.getString("status")),
                ServiceRequestPriority.valueOf(resultSet.getString("priority")),
                resultSet.getTimestamp("created_at").toInstant(),
                resultSet.getString("assignee"));
    }
}
