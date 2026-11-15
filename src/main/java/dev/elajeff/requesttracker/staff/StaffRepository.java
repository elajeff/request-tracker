package dev.elajeff.requesttracker.staff;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
public class StaffRepository {
    private static final RowMapper<SupportStaff> ROW_MAPPER = (row, number) -> new SupportStaff(
            row.getObject("id", UUID.class), row.getString("name"), row.getBoolean("active"));

    private final JdbcTemplate jdbc;

    public StaffRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public SupportStaff create(String name) {
        UUID id = UUID.randomUUID();
        return jdbc.queryForObject("INSERT INTO support_staff (id, name) VALUES (?, ?) RETURNING id, name, active",
                ROW_MAPPER, id, name);
    }

    public Optional<SupportStaff> findByIdForUpdate(UUID id) {
        return jdbc.query("SELECT id, name, active FROM support_staff WHERE id = ? FOR UPDATE", ROW_MAPPER, id)
                .stream().findFirst();
    }

    // COLLATE "C" compares the lowercased names byte by byte, not by the database's collation.
    public List<SupportStaff> findPage(StaffCursor cursor, int limit, String query) {
        String afterName = cursor == null ? null : cursor.name();
        UUID afterId = cursor == null ? null : cursor.id();
        return jdbc.query("""
                SELECT id, name, active FROM support_staff WHERE strpos(lower(name), lower(?)) > 0
                    AND (?::varchar IS NULL OR (lower(name) COLLATE "C", id) > (lower(?::varchar) COLLATE "C", ?::uuid))
                ORDER BY lower(name) COLLATE "C", id LIMIT ?
                """, ROW_MAPPER, query, afterName, afterName, afterId, limit);
    }

    public SupportStaff rename(UUID id, String name) {
        return jdbc.queryForObject("UPDATE support_staff SET name = ? WHERE id = ? RETURNING id, name, active",
                ROW_MAPPER, name, id);
    }

    public SupportStaff setActive(UUID id, boolean active) {
        return jdbc.queryForObject("UPDATE support_staff SET active = ? WHERE id = ? RETURNING id, name, active",
                ROW_MAPPER, active, id);
    }
}
