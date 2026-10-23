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

    public ServiceRequest create(String title, String description) {
        UUID id = UUID.randomUUID();

        return jdbcTemplate.queryForObject("""
                INSERT INTO service_requests (id, title, description, status)
                VALUES (?, ?, ?, ?)
                RETURNING id, title, description, status, created_at
                """,
                ROW_MAPPER,
                id,
                title,
                description,
                ServiceRequestStatus.NEW.name());
    }

    public List<ServiceRequest> findAll() {
        return jdbcTemplate.query("""
                SELECT id, title, description, status, created_at
                FROM service_requests
                ORDER BY created_at DESC, id DESC
                """, ROW_MAPPER);
    }

    public Optional<ServiceRequest> findById(UUID id) {
        List<ServiceRequest> matches = jdbcTemplate.query("""
                SELECT id, title, description, status, created_at
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
                resultSet.getTimestamp("created_at").toInstant());
    }
}
