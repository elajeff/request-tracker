package dev.elajeff.requesttracker;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class StaffIntegrationTest {
    private static final HttpClient CLIENT = HttpClient.newHttpClient();
    @Value("${local.server.port}") private int port;
    @Autowired private JsonMapper json;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private DataSource dataSource;

    @Test
    void directorySupportsCreateRenameDeactivateReactivateWithoutMergingNames() throws Exception {
        JsonNode first = staff("  Support Person  ");
        String id = first.get("id").asText();
        assertEquals("Support Person", first.get("name").asText());
        assertTrue(first.get("active").asBoolean());
        assertNotEquals(id, staff("Support Person").get("id").asText());
        assertEquals("Renamed Person", ok("PUT", "/api/staff/" + id,
                Map.of("name", "Renamed Person"), 200).get("name").asText());
        assertFalse(active(id, false).get("active").asBoolean());
        assertTrue(active(id, true).get("active").asBoolean());
        assertEquals(405, send("DELETE", "/api/staff/" + id, null).statusCode());
        for (Object body : List.of(Map.of("name", " "), Map.of("name", "x".repeat(121)), Map.of())) {
            assertEquals(400, send("POST", "/api/staff", body).statusCode());
            assertEquals(400, send("PUT", "/api/staff/" + id, body).statusCode());
        }
        assertEquals(400, send("PATCH", "/api/staff/" + id + "/active", Map.of()).statusCode());
        assertEquals(404, send("PUT", "/api/staff/" + UUID.randomUUID(), Map.of("name", "Missing")).statusCode());
        assertEquals(404, send("PATCH", "/api/staff/" + UUID.randomUUID() + "/active", Map.of("active", false)).statusCode());
        UUID blank = UUID.randomUUID();
        jdbc.update("INSERT INTO support_staff (id,name,active) VALUES (?, ' ', false)", blank);
        assertEquals(400, send("PATCH", "/api/staff/" + blank + "/active", Map.of("active", true)).statusCode());
        JsonNode firstPage = ok("GET", "/api/staff?limit=1", null, 200);
        JsonNode second = ok("GET", "/api/staff?limit=1&cursor=" + firstPage.get("nextCursor").asText(), null, 200);
        assertTrue(firstPage.get("items").get(0).get("id").asText()
                .compareTo(second.get("items").get(0).get("id").asText()) < 0);
        for (String query : List.of("limit=0", "limit=101", "limit=abc", "cursor=bad", "cursor=")) {
            assertEquals(400, send("GET", "/api/staff?" + query, null).statusCode());
        }
    }

    @Test
    void inactiveStaffKeepAssignmentsButCannotReceiveNewOnes() throws Exception {
        String person = staff("Inactive staff").get("id").asText();
        String assigned = request("Assigned");
        String other = request("Other");
        assign(assigned, person, 200);
        long historyBefore = historyCount(assigned);
        active(person, false);
        JsonNode retained = ok("GET", "/api/requests/" + assigned, null, 200);
        assertEquals(person, retained.get("assigneeId").asText());
        assertFalse(retained.get("assigneeActive").asBoolean());
        assign(assigned, person, 200);
        assertEquals(historyBefore, historyCount(assigned));
        assign(other, person, 400);
        assertTrue(ok("GET", "/api/requests/" + other, null, 200).get("assigneeId").isNull());
        assertEquals(1, historyCount(other));
        String replacement = staff("Replacement").get("id").asText();
        assign(assigned, replacement, 200);
        active(replacement, false);
        assertTrue(ok("PATCH", "/api/requests/" + assigned + "/assignment",
                Map.of("unassign", true), 200).get("assigneeId").isNull());
        active(person, true);
        assign(other, person, 200);
        assign(other, UUID.randomUUID().toString(), 404);
        for (Object body : List.of(Map.of(), Map.of("unassign", false),
                Map.of("staffId", person, "unassign", true), Map.of("staffId", "bad"))) {
            assertEquals(400, send("PATCH", "/api/requests/" + other + "/assignment", body).statusCode());
        }
    }

    @Test
    void assignmentHistoryKeepsNamesAndIdsAtTheTimeOfEachChange() throws Exception {
        String person = staff("Original name").get("id").asText();
        String request = request("Historical snapshots");
        assign(request, person, 200);
        JsonNode original = history(request);
        assertEquals("Original name [" + person + "]", original.get("items").get(0).get("newValue").asText());
        ok("PUT", "/api/staff/" + person, Map.of("name", "Renamed staff"), 200);
        assertEquals("Renamed staff", ok("GET", "/api/requests/" + request, null, 200).get("assignee").asText());
        assertEquals(original, history(request));
        String sameName = staff("Renamed staff").get("id").asText();
        assign(request, sameName, 200);
        JsonNode change = history(request).get("items").get(0);
        assertEquals("Renamed staff [" + person + "]", change.get("oldValue").asText());
        assertEquals("Renamed staff [" + sameName + "]", change.get("newValue").asText());
        assertEquals(3, historyCount(request));
    }

    @Test
    void staffAndUnassignedFiltersCombineWithSearchAndStablePagination() throws Exception {
        String query = UUID.randomUUID().toString();
        String person = staff("Filter staff").get("id").asText();
        String sameName = staff("Filter staff").get("id").asText();
        List<String> expected = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            String id = request(query);
            assign(id, person, 200);
            jdbc.update("UPDATE service_requests SET created_at = '2026-01-01' WHERE id = ?::uuid", id);
            expected.add(id);
        }
        expected.sort(java.util.Comparator.reverseOrder());
        String unassigned = request(query);
        assign(request(query), sameName, 200);
        assign(request("Outside search"), person, 200);
        active(person, false);
        String path = "/api/requests?q=" + query + "&staffId=" + person + "&limit=2";
        JsonNode first = ok("GET", path, null, 200);
        assertEquals(expected.subList(0, 2), ids(first));
        JsonNode last = ok("GET", path + "&cursor=" + first.get("nextCursor").asText(), null, 200);
        assertEquals(expected.subList(2, 3), ids(last));
        assertTrue(last.get("nextCursor").isNull());
        assertEquals(List.of(unassigned), ids(ok("GET", "/api/requests?q=" + query + "&unassigned=true", null, 200)));
        assertEquals(400, send("GET", path + "&unassigned=true", null).statusCode());
        assertEquals(400, send("GET", "/api/requests?staffId=bad", null).statusCode());
        assertEquals(0, ok("GET", "/api/requests?staffId=" + UUID.randomUUID(), null, 200).get("items").size());
    }

    @Test
    void migrationPreservesEveryLegacyAssignmentAndHistoryWithoutMerging() {
        String schema = "staff_migration_" + UUID.randomUUID().toString().replace("-", "");
        try {
            Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).target("4").load().migrate();
            List<String> labels = List.of("Alex", "Alex", "alex", " Alex ", "", "   ");
            List<UUID> requests = new ArrayList<>();
            for (String label : labels) {
                UUID id = UUID.randomUUID();
                requests.add(id);
                jdbc.update("INSERT INTO " + schema + ".service_requests (id,title,description,assignee) VALUES (?, 'Legacy', 'Preserve', ?)", id, label);
                jdbc.update("INSERT INTO " + schema + ".request_history (request_id,field,old_value,new_value) VALUES (?, 'ASSIGNEE', 'Earlier name', ?)", id, label);
            }
            UUID unassigned = UUID.randomUUID();
            jdbc.update("INSERT INTO " + schema + ".service_requests (id,title,description) VALUES (?, 'Unassigned', 'Keep null')", unassigned);
            List<Map<String, Object>> history = jdbc.queryForList("SELECT * FROM " + schema + ".request_history ORDER BY id");
            Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).load().migrate();
            assertEquals(labels.size(), jdbc.queryForObject("SELECT count(*) FROM " + schema + ".support_staff", Integer.class));
            for (int i = 0; i < requests.size(); i++) {
                String name = jdbc.queryForObject("SELECT s.name FROM " + schema + ".service_requests r JOIN " + schema
                        + ".support_staff s ON s.id=r.assignee_id WHERE r.id=?", String.class, requests.get(i));
                assertEquals(labels.get(i), name);
            }
            assertEquals(labels.size(), jdbc.queryForObject("SELECT count(DISTINCT assignee_id) FROM " + schema + ".service_requests", Integer.class));
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM " + schema + ".support_staff WHERE active", Integer.class));
            assertNull(jdbc.queryForObject("SELECT assignee_id FROM " + schema + ".service_requests WHERE id=?", UUID.class, unassigned));
            assertEquals(history, jdbc.queryForList("SELECT * FROM " + schema + ".request_history ORDER BY id"));
        } finally {
            jdbc.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }

    private JsonNode staff(String name) throws Exception { return ok("POST", "/api/staff", Map.of("name", name), 201); }
    private JsonNode active(String id, boolean active) throws Exception {
        return ok("PATCH", "/api/staff/" + id + "/active", Map.of("active", active), 200);
    }
    private String request(String title) throws Exception {
        return ok("POST", "/api/requests", Map.of("title", title, "description", "Staff workflow test"), 201).get("id").asText();
    }
    private void assign(String id, String staffId, int status) throws Exception {
        ok("PATCH", "/api/requests/" + id + "/assignment", Map.of("staffId", staffId), status);
    }
    private JsonNode history(String id) throws Exception { return ok("GET", "/api/requests/" + id + "/history", null, 200); }
    private long historyCount(String id) { return jdbc.queryForObject("SELECT count(*) FROM request_history WHERE request_id=?::uuid", Long.class, id); }
    private List<String> ids(JsonNode page) {
        List<String> ids = new ArrayList<>();
        page.get("items").forEach(item -> ids.add(item.get("id").asText()));
        return ids;
    }
    private JsonNode ok(String method, String path, Object body, int status) throws Exception {
        HttpResponse<String> response = send(method, path, body);
        assertEquals(status, response.statusCode(), response.body());
        return json.readTree(response.body());
    }
    private HttpResponse<String> send(String method, String path, Object body) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                .timeout(Duration.ofSeconds(5)).header("Content-Type", "application/json")
                .method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                        : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build();
        return CLIENT.send(request, HttpResponse.BodyHandlers.ofString());
    }
}
