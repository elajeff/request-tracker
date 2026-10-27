package dev.elajeff.requesttracker;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class PaginationIntegrationTest {
    private static final HttpClient CLIENT = HttpClient.newHttpClient();

    @Value("${local.server.port}")
    private int port;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private JsonMapper json;

    @Test
    void queuePagesBreakTimestampTiesAndDoNotShiftAfterNewInserts() throws Exception {
        String query = UUID.randomUUID().toString();
        List<String> ids = new ArrayList<>();
        String prefix = UUID.randomUUID().toString().substring(0, 8);
        for (int i = 1; i <= 5; i++) {
            String id = prefix + "-0000-0000-0000-" + String.format("%012d", i);
            insert(id, query, "Details", null, "2026-01-01T00:00:00Z");
            ids.add(id);
        }
        JsonNode first = page("/api/requests?q=" + query + "&limit=2");
        assertEquals(List.of(ids.get(4), ids.get(3)), itemIds(first));
        assertEquals(jdbc.queryForObject("SELECT count(*) FROM service_requests", Long.class),
                first.get("counts").get("total").asLong());

        insert(UUID.randomUUID().toString(), query, "New arrival", null, "2026-02-01T00:00:00Z");
        JsonNode second = page("/api/requests?q=" + query + "&limit=2&cursor=" + cursor(first));
        assertEquals(List.of(ids.get(2), ids.get(1)), itemIds(second));
        JsonNode last = page("/api/requests?q=" + query + "&limit=2&cursor=" + cursor(second));
        assertEquals(List.of(ids.get(0)), itemIds(last));
        assertTrue(last.get("nextCursor").isNull());
    }

    @Test
    void queueSearchCoversUnloadedRecordsAndTreatsWildcardsLiterally() throws Exception {
        String token = UUID.randomUUID().toString();
        String target = UUID.randomUUID().toString();
        insert(target, token + " older", "Literal 50%_\\ discount", "Alex Support", "2025-01-01T00:00:00Z");
        for (int i = 0; i < 26; i++) {
            insert(UUID.randomUUID().toString(), token, "Newer", null, "2026-01-01T00:00:00Z");
        }
        JsonNode initial = page("/api/requests?q=" + token);
        assertEquals(25, initial.get("items").size());
        assertFalse(itemIds(initial).contains(target));
        for (String query : List.of(token + " older", "50%_\\", "aLeX sUpPoRt", target.toUpperCase())) {
            assertEquals(List.of(target), itemIds(page("/api/requests?q=" + encode("  " + query + "  "))));
        }
        JsonNode empty = page("/api/requests?q=" + UUID.randomUUID());
        assertEquals(0, empty.get("items").size());
        assertTrue(empty.get("nextCursor").isNull());
    }

    @Test
    void fullFinalQueuePageHasNoNextCursor() throws Exception {
        String query = UUID.randomUUID().toString();
        for (int i = 0; i < 4; i++) {
            insert(UUID.randomUUID().toString(), query, "Details", null, "2026-01-01T00:00:00Z");
        }
        JsonNode first = page("/api/requests?q=" + query + "&limit=2");
        JsonNode last = page("/api/requests?q=" + query + "&limit=2&cursor=" + cursor(first));
        assertEquals(2, last.get("items").size());
        assertTrue(last.get("nextCursor").isNull());
    }

    @Test
    void historyPagesAreScopedNewestFirstAndStableAcrossNewChanges() throws Exception {
        String id = UUID.randomUUID().toString();
        insert(id, "History pagination", "Details", null, "2026-01-01T00:00:00Z");
        List<String> ids = new ArrayList<>();
        for (int i = 0; i < 4; i++) ids.add(change(id, "Staff " + i));
        String other = UUID.randomUUID().toString();
        insert(other, "Other history", "Details", null, "2026-01-01T00:00:00Z");
        change(other, "Other staff");
        String path = "/api/requests/" + id + "/history?limit=2";
        JsonNode first = page(path);
        assertEquals(List.of(ids.get(3), ids.get(2)), itemIds(first));
        assertEquals("ASSIGNEE", first.get("items").get(0).get("field").asText());
        assertEquals("Staff 3", first.get("items").get(0).get("newValue").asText());
        change(id, "New arrival");
        JsonNode last = page(path + "&cursor=" + cursor(first));
        assertEquals(List.of(ids.get(1), ids.get(0)), itemIds(last));
        assertTrue(last.get("nextCursor").isNull());
        JsonNode pastEnd = page(path + "&cursor=" + ids.get(0));
        assertEquals(0, pastEnd.get("items").size());
        assertTrue(pastEnd.get("nextCursor").isNull());
        assertEquals(404, get("/api/requests/" + UUID.randomUUID() + "/history").statusCode());
    }

    @Test
    void invalidPaginationParametersReturnBadRequest() throws Exception {
        String id = UUID.randomUUID().toString();
        insert(id, "Invalid parameters", "Details", null, "2026-01-01T00:00:00Z");
        for (String path : List.of("/api/requests", "/api/requests/" + id + "/history")) {
            for (String limit : List.of("0", "-1", "101", "2147483648", "abc")) {
                assertEquals(400, get(path + "?limit=" + limit).statusCode(), path + " limit=" + limit);
            }
            for (String cursor : List.of("", "garbage", "-1", "0", "99999999999999999999999")) {
                assertEquals(400, get(path + "?cursor=" + cursor).statusCode(), path + " cursor=" + cursor);
            }
            assertEquals(200, get(path + "?limit=100").statusCode());
        }
        for (String decoded : List.of("not-a-date," + id, "2026-01-01T00:00:00Z,invalid",
                "2026-01-01T00:00:00Z,1-1-1-1-1", "2026-01-01T00:00:00Z," + id + ",extra")) {
            String cursor = Base64.getUrlEncoder().withoutPadding().encodeToString(decoded.getBytes(StandardCharsets.UTF_8));
            assertEquals(400, get("/api/requests?cursor=" + cursor).statusCode());
        }
    }

    private void insert(String id, String title, String description, String assignee, String createdAt) {
        jdbc.update("""
                INSERT INTO service_requests (id, title, description, assignee, created_at)
                VALUES (?::uuid, ?, ?, ?, ?::timestamptz)
                """, id, title, description, assignee, createdAt);
    }

    private String change(String requestId, String assignee) {
        return jdbc.queryForObject("""
                INSERT INTO request_history (request_id, field, old_value, new_value)
                VALUES (?::uuid, 'ASSIGNEE', NULL, ?) RETURNING id
                """, Long.class, requestId, assignee).toString();
    }

    private JsonNode page(String path) throws Exception {
        HttpResponse<String> response = get(path);
        assertEquals(200, response.statusCode(), response.body());
        return json.readTree(response.body());
    }

    private List<String> itemIds(JsonNode page) {
        List<String> ids = new ArrayList<>();
        page.get("items").forEach(item -> ids.add(item.get("id").asText()));
        return ids;
    }

    private String cursor(JsonNode page) {
        assertFalse(page.get("nextCursor").isNull());
        return encode(page.get("nextCursor").asText());
    }

    private String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private HttpResponse<String> get(String path) throws Exception {
        return CLIENT.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).GET().build(),
                HttpResponse.BodyHandlers.ofString());
    }
}
