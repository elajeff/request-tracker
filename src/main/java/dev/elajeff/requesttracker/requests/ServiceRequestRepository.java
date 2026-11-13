package dev.elajeff.requesttracker.requests;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
public class ServiceRequestRepository {
    private static final RowMapper<ServiceRequest> ROW_MAPPER = (row, number) -> new ServiceRequest(
            row.getObject("id", UUID.class), row.getString("title"), row.getString("description"),
            ServiceRequestStatus.valueOf(row.getString("status")),
            ServiceRequestPriority.valueOf(row.getString("priority")),
            row.getTimestamp("created_at").toInstant(), row.getString("assignee"),
            row.getObject("assignee_id", UUID.class), row.getObject("assignee_active", Boolean.class));

    private static final RowMapper<RequestHistoryEntry> HISTORY_ROW_MAPPER = (row, number) -> new RequestHistoryEntry(
            row.getLong("id"), row.getString("field"), row.getString("old_value"), row.getString("new_value"),
            row.getTimestamp("changed_at").toInstant(), row.getString("actor_username"));

    private static final String SELECT_REQUEST = """
            SELECT r.id, r.title, r.description, r.status, r.priority, r.created_at,
                r.assignee_id, s.name AS assignee, s.active AS assignee_active
            FROM service_requests r LEFT JOIN support_staff s ON s.id = r.assignee_id
            """;

    private final JdbcTemplate jdbc;

    public ServiceRequestRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public ServiceRequest create(String title, String description, ServiceRequestPriority priority, UUID ownerId) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO service_requests (id, title, description, status, priority, owner_id)
                VALUES (?, ?, ?, ?, ?, ?)
                """, id, title, description, ServiceRequestStatus.NEW.name(), priority.name(), ownerId);
        return findById(id, null).orElseThrow();
    }

    public void updateDetails(UUID id, String title, String description) {
        jdbc.update("UPDATE service_requests SET title = ?, description = ? WHERE id = ?",
                title, description, id);
    }

    public void updateStatus(UUID id, ServiceRequestStatus status) {
        jdbc.update("UPDATE service_requests SET status = ? WHERE id = ?", status.name(), id);
    }

    public void updatePriority(UUID id, ServiceRequestPriority priority) {
        jdbc.update("UPDATE service_requests SET priority = ? WHERE id = ?", priority.name(), id);
    }

    public void updateAssignment(UUID id, UUID staffId) {
        jdbc.update("UPDATE service_requests SET assignee_id = ? WHERE id = ?", staffId, id);
    }

    public List<ServiceRequest> findPage(String query, UUID staffId, boolean unassigned, ServiceRequestStatus status,
            QueueCursor after, int limit, UUID ownerId) {
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
        if (after != null) {
            sql += " AND (r.created_at, r.id) < (?, ?)";
            parameters.add(Timestamp.from(after.createdAt()));
            parameters.add(after.id());
        }
        sql += " ORDER BY r.created_at DESC, r.id DESC LIMIT ?";
        parameters.add(limit);
        return jdbc.query(sql, ROW_MAPPER, parameters.toArray());
    }

    public RequestQueuePage.Counts counts(UUID ownerId) {
        return jdbc.queryForObject("""
                SELECT count(*) AS total,
                    count(*) FILTER (WHERE status = 'NEW') AS new_count,
                    count(*) FILTER (WHERE status = 'IN_PROGRESS') AS in_progress_count,
                    count(*) FILTER (WHERE status = 'RESOLVED') AS resolved_count
                FROM service_requests WHERE (?::uuid IS NULL OR owner_id = ?)
                """, (row, number) -> new RequestQueuePage.Counts(row.getLong("total"), row.getLong("new_count"),
                        row.getLong("in_progress_count"), row.getLong("resolved_count")), ownerId, ownerId);
    }

    public Optional<ServiceRequest> findById(UUID id, UUID ownerId) {
        return jdbc.query(SELECT_REQUEST + " WHERE r.id = ? AND (?::uuid IS NULL OR r.owner_id = ?)",
                ROW_MAPPER, id, ownerId, ownerId).stream().findFirst();
    }

    public Optional<ServiceRequest> findByIdForUpdate(UUID id, UUID ownerId) {
        return jdbc.query(SELECT_REQUEST + " WHERE r.id = ? AND (?::uuid IS NULL OR r.owner_id = ?) FOR UPDATE OF r",
                ROW_MAPPER, id, ownerId, ownerId).stream().findFirst();
    }

    public boolean setOwnerIfNone(UUID id, UUID ownerId) {
        return jdbc.update("UPDATE service_requests SET owner_id = ? WHERE id = ? AND owner_id IS NULL", ownerId, id) == 1;
    }

    public void recordChange(UUID id, String field, String oldValue, String newValue, UUID actorId, String actorUsername) {
        jdbc.update("""
                INSERT INTO request_history (request_id, field, old_value, new_value, actor_account_id, actor_username)
                VALUES (?, ?, ?, ?, ?, ?)
                """, id, field, oldValue, newValue, actorId, actorUsername);
    }

    public List<RequestHistoryEntry> findHistory(UUID id, Long beforeId, int limit) {
        return jdbc.query("""
                SELECT id, field, old_value, new_value, changed_at, actor_username
                FROM request_history WHERE request_id = ? AND (?::bigint IS NULL OR id < ?)
                ORDER BY id DESC LIMIT ?
                """, HISTORY_ROW_MAPPER, id, beforeId, beforeId, limit);
    }
}
