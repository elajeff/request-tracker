package dev.elajeff.requesttracker.requests;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
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

    private static final String SELECT_REQUEST = """
            SELECT r.id, r.title, r.description, r.status, r.priority, r.created_at,
                r.assignee_id, s.name AS assignee, s.active AS assignee_active
            FROM service_requests r LEFT JOIN support_staff s ON s.id = r.assignee_id
            """;

    private final JdbcTemplate jdbcTemplate;

    public ServiceRequestRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public ServiceRequest create(
            String title, String description, ServiceRequestPriority priority, UUID ownerId) {
        UUID id = UUID.randomUUID();

        jdbcTemplate.update("""
                INSERT INTO service_requests
                    (id, title, description, status, priority, owner_id)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                id,
                title,
                description,
                ServiceRequestStatus.NEW.name(),
                priority.name(), ownerId);
        return findById(id, null).orElseThrow();
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

    public List<ServiceRequest> findPage(String query, UUID staffId, boolean unassigned, ServiceRequestStatus status,
            Instant beforeCreatedAt, UUID beforeId, int limit, UUID ownerId) {
        String sql = SELECT_REQUEST + """
                WHERE strpos(lower(concat_ws(' ', r.title, r.description, r.id::text, coalesce(s.name, ''))), lower(?)) > 0
                """;
        List<Object> parameters = new ArrayList<>();
        parameters.add(query);
        if (ownerId != null) {
            sql += " AND r.owner_id = ?";
            parameters.add(ownerId);
        }
        if (staffId != null) {
            sql += " AND r.assignee_id = ?";
            parameters.add(staffId);
        } else if (unassigned) {
            sql += " AND r.assignee_id IS NULL";
        }
        if (status != null) {
            sql += " AND r.status = ?";
            parameters.add(status.name());
        }
        if (beforeCreatedAt != null) {
            sql += " AND (r.created_at, r.id) < (?, ?)";
            parameters.add(Timestamp.from(beforeCreatedAt));
            parameters.add(beforeId);
        }
        sql += " ORDER BY r.created_at DESC, r.id DESC LIMIT ?";
        parameters.add(limit);
        return jdbcTemplate.query(sql, ROW_MAPPER, parameters.toArray());
    }

    public RequestQueuePage.Counts counts(UUID ownerId) {
        return jdbcTemplate.queryForObject("""
                SELECT count(*) AS total,
                    count(*) FILTER (WHERE status = 'NEW') AS new_count,
                    count(*) FILTER (WHERE status = 'IN_PROGRESS') AS in_progress_count,
                    count(*) FILTER (WHERE status = 'RESOLVED') AS resolved_count
                FROM service_requests WHERE (?::uuid IS NULL OR owner_id = ?)
                """, (row, number) -> new RequestQueuePage.Counts(row.getLong("total"),
                row.getLong("new_count"), row.getLong("in_progress_count"), row.getLong("resolved_count")), ownerId, ownerId);
    }

    public Optional<ServiceRequest> findById(UUID id, UUID ownerId) {
        List<ServiceRequest> matches = jdbcTemplate.query(SELECT_REQUEST + " WHERE r.id = ? AND (?::uuid IS NULL OR r.owner_id = ?)", ROW_MAPPER, id, ownerId, ownerId);

        return matches.stream().findFirst();
    }

    public Optional<ServiceRequest> findByIdForUpdate(UUID id, UUID ownerId) {
        return jdbcTemplate.query(SELECT_REQUEST + " WHERE r.id = ? AND (?::uuid IS NULL OR r.owner_id = ?) FOR UPDATE OF r",
                ROW_MAPPER, id, ownerId, ownerId).stream().findFirst();
    }

    public void updateAssignment(UUID id, UUID staffId) {
        jdbcTemplate.update("UPDATE service_requests SET assignee_id = ? WHERE id = ?", staffId, id);
    }

    public void recordChange(UUID id, String field, String oldValue, String newValue, UUID actorId, String actorUsername) {
        jdbcTemplate.update("""
                INSERT INTO request_history (request_id, field, old_value, new_value, actor_account_id, actor_username)
                VALUES (?, ?, ?, ?, ?, ?)
                """, id, field, oldValue, newValue, actorId, actorUsername);
    }

    public List<RequestHistoryEntry> findHistory(UUID id, Long beforeId, int limit) {
        return jdbcTemplate.query("""
                SELECT id, field, old_value, new_value, changed_at, actor_username
                FROM request_history WHERE request_id = ? AND (?::bigint IS NULL OR id < ?)
                ORDER BY id DESC LIMIT ?
                """, (row, number) -> new RequestHistoryEntry(row.getLong("id"),
                row.getString("field"), row.getString("old_value"), row.getString("new_value"),
                row.getTimestamp("changed_at").toInstant(), row.getString("actor_username")), id, beforeId, beforeId, limit);
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
                resultSet.getString("assignee"),
                resultSet.getObject("assignee_id", UUID.class),
                resultSet.getObject("assignee_active", Boolean.class));
    }
}
