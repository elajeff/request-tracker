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
        return jdbc.queryForObject("INSERT INTO support_staff (id, name) VALUES (?, ?) RETURNING *",
                ROW_MAPPER, id, name);
    }

    public Optional<SupportStaff> findByIdForUpdate(UUID id) {
        return jdbc.query("SELECT * FROM support_staff WHERE id = ? FOR UPDATE", ROW_MAPPER, id)
                .stream().findFirst();
    }

    public List<SupportStaff> findPage(UUID cursor, int limit, String query) {
        return jdbc.query("""
                SELECT * FROM support_staff WHERE strpos(lower(name), lower(?)) > 0
                    AND (?::uuid IS NULL OR id > ?)
                ORDER BY id LIMIT ?
                """, ROW_MAPPER, query, cursor, cursor, limit);
    }

    public SupportStaff rename(UUID id, String name) {
        return jdbc.queryForObject("UPDATE support_staff SET name = ? WHERE id = ? RETURNING *",
                ROW_MAPPER, name, id);
    }

    public SupportStaff setActive(UUID id, boolean active) {
        return jdbc.queryForObject("UPDATE support_staff SET active = ? WHERE id = ? RETURNING *",
                ROW_MAPPER, active, id);
    }
}
