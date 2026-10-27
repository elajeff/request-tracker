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
                RETURNING id, title, description, status, priority, created_at
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
                SELECT id, title, description, status, priority, created_at
                FROM service_requests
                ORDER BY created_at DESC, id DESC
                """, ROW_MAPPER);
    }

    public Optional<ServiceRequest> findById(UUID id) {
        List<ServiceRequest> matches = jdbcTemplate.query("""
                SELECT id, title, description, status, priority, created_at
                FROM service_requests
                WHERE id = ?
                """, ROW_MAPPER, id);

        return matches.stream().findFirst();
    }

    private static ServiceRequest mapRow(ResultSet resultSet, int rowNumber)
            throws SQLException {
        return new ServiceRequest(
                resultSet.getObject("id", UUID.class),
                resultSet.getString("title"),
                resultSet.getString("description"),
                ServiceRequestStatus.valueOf(resultSet.getString("status")),
                ServiceRequestPriority.valueOf(resultSet.getString("priority")),
                resultSet.getTimestamp("created_at").toInstant());
    }
}
