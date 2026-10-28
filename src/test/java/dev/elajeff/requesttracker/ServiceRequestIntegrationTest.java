package dev.elajeff.requesttracker;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.UUID;
import java.util.regex.Pattern;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import dev.elajeff.requesttracker.requests.ServiceRequestRepository;
import dev.elajeff.requesttracker.requests.ServiceRequestService;
import org.springframework.boot.test.context.SpringBootTest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ServiceRequestIntegrationTest {

    private static final HttpClient CLIENT = HttpClient.newHttpClient();
    private static final Pattern ID_PATTERN =
            Pattern.compile("\"id\"\\s*:\\s*\"([0-9a-fA-F-]{36})\"");

    @Value("${local.server.port}")
    private int port;

    @Test
    void createRequestCanBeRetrievedAndListed() throws Exception {
        String title = "Laptop access " + UUID.randomUUID();
        String description = "Set up access for a new employee.";
        String json = "{\"title\":\"" + title
                + "\",\"description\":\"" + description + "\"}";

        HttpResponse<String> created = post("/api/requests", json);

        assertEquals(201, created.statusCode());
        assertTrue(created.body().contains(title), created.body());
        assertTrue(created.body().contains("\"status\":\"NEW\""), created.body());
        assertTrue(created.body().contains("\"priority\":\"MEDIUM\""), created.body());

        var matcher = ID_PATTERN.matcher(created.body());
        assertTrue(matcher.find(), created.body());
        String id = matcher.group(1);

        HttpResponse<String> retrieved = get("/api/requests/" + id);

        assertEquals(200, retrieved.statusCode());
        assertTrue(retrieved.body().contains(title), retrieved.body());
        assertTrue(retrieved.body().contains(description), retrieved.body());

        HttpResponse<String> listed = get("/api/requests");

        assertEquals(200, listed.statusCode());
        assertTrue(listed.body().contains(id), listed.body());
    }

    @Test
    void requestDetailsCanBeEditedAndPersisted() throws Exception {
        String id = createRequestAndGetId();
        String title = "Updated request " + UUID.randomUUID();
        String description = "Updated description.";

        HttpResponse<String> updated = put(
                "/api/requests/" + id,
                "{\"title\":\"" + title
                        + "\",\"description\":\"" + description + "\"}");

        assertEquals(200, updated.statusCode());
        assertTrue(updated.body().contains(title), updated.body());
        assertTrue(updated.body().contains(description), updated.body());

        HttpResponse<String> retrieved = get("/api/requests/" + id);
        assertTrue(retrieved.body().contains(title), retrieved.body());
        assertTrue(retrieved.body().contains(description), retrieved.body());

        HttpResponse<String> invalid = put(
                "/api/requests/" + id,
                "{\"title\":\"   \",\"description\":\"Valid description.\"}");
        assertEquals(400, invalid.statusCode());

        HttpResponse<String> missing = put(
                "/api/requests/" + UUID.randomUUID(),
                "{\"title\":\"Missing request\",\"description\":\"Valid description.\"}");
        assertEquals(404, missing.statusCode());
    }
    @Test
    void priorityCanBeSetAndUpdated() throws Exception {
        String title = "Urgent access " + UUID.randomUUID();
        String json = "{\"title\":\"" + title
                + "\",\"description\":\"Access needed.\",\"priority\":\"HIGH\"}";

        HttpResponse<String> created = post("/api/requests", json);
        assertEquals(201, created.statusCode());
        assertTrue(created.body().contains("\"priority\":\"HIGH\""), created.body());

        var matcher = ID_PATTERN.matcher(created.body());
        assertTrue(matcher.find(), created.body());
        String id = matcher.group(1);

        HttpResponse<String> updated = patch(
                "/api/requests/" + id + "/priority",
                "{\"priority\":\"LOW\"}");

        assertEquals(200, updated.statusCode());
        assertTrue(updated.body().contains("\"priority\":\"LOW\""), updated.body());

        HttpResponse<String> retrieved = get("/api/requests/" + id);
        assertTrue(retrieved.body().contains("\"priority\":\"LOW\""), retrieved.body());

        HttpResponse<String> invalid = patch(
                "/api/requests/" + id + "/priority",
                "{\"priority\":\"URGENT\"}");

        assertEquals(400, invalid.statusCode());
    }

    @Test
    void statusMovesForwardAndIsPersisted() throws Exception {
        String id = createRequestAndGetId();

        assertEquals(400, patch("/api/requests/" + id + "/status",
                "{\"status\":\"RESOLVED\"}").statusCode());

        HttpResponse<String> inProgress = patch("/api/requests/" + id + "/status",
                "{\"status\":\"IN_PROGRESS\"}");

        assertEquals(200, inProgress.statusCode());
        assertTrue(inProgress.body().contains("\"status\":\"IN_PROGRESS\""),
                inProgress.body());

        HttpResponse<String> retrieved = get("/api/requests/" + id);
        assertTrue(retrieved.body().contains("\"status\":\"IN_PROGRESS\""),
                retrieved.body());

        HttpResponse<String> resolved = patch("/api/requests/" + id + "/status",
                "{\"status\":\"RESOLVED\"}");

        assertEquals(200, resolved.statusCode());
        assertTrue(resolved.body().contains("\"status\":\"RESOLVED\""),
                resolved.body());

        retrieved = get("/api/requests/" + id);
        assertTrue(retrieved.body().contains("\"status\":\"RESOLVED\""),
                retrieved.body());
    }

    @Test
    void invalidStatusIsRejected() throws Exception {
        String id = createRequestAndGetId();

        HttpResponse<String> response = patch("/api/requests/" + id + "/status",
                "{\"status\":\"CLOSED\"}");

        assertEquals(400, response.statusCode());
    }

    @Test
    void unknownRequestStatusUpdateReturnsNotFound() throws Exception {
        HttpResponse<String> response = patch(
                "/api/requests/" + UUID.randomUUID() + "/status",
                "{\"status\":\"IN_PROGRESS\"}");

        assertEquals(404, response.statusCode());
    }

    @Test
    void blankTitleIsRejected() throws Exception {
        HttpResponse<String> response = post(
                "/api/requests",
                "{\"title\":\"   \",\"description\":\"A valid description.\"}");

        assertEquals(400, response.statusCode());
    }

    @Test
    void unknownRequestReturnsNotFound() throws Exception {
        HttpResponse<String> response = get(
                "/api/requests/" + UUID.randomUUID());

        assertEquals(404, response.statusCode());
    }

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private ServiceRequestService service;

    @MockitoSpyBean
    private ServiceRequestRepository repository;

    @Test
    void assignmentCanBeChangedClearedAndValidated() throws Exception {
        String id = createRequestAndGetId();
        String path = "/api/requests/" + id + "/assignment";
        assertEquals(200, patch(path, "{\"assignee\":\"  Alex Support  \"}").statusCode());
        assertTrue(get("/api/requests/" + id).body().contains("\"assignee\":\"Alex Support\""));
        assertEquals(200, patch(path, "{\"assignee\":\"Sam Support\"}").statusCode());
        assertEquals(200, patch(path, "{\"assignee\":\"   \"}").statusCode());
        assertTrue(get("/api/requests/" + id).body().contains("\"assignee\":null"));
        assertEquals(400, patch(path, "{}").statusCode());
        assertEquals(400, patch(path, "{\"assignee\":null}").statusCode());
        assertEquals(400, patch(path, "{\"assignee\":\"" + "x".repeat(121) + "\"}").statusCode());
        assertEquals(404, patch("/api/requests/" + UUID.randomUUID() + "/assignment",
                "{\"assignee\":\"Alex\"}").statusCode());
    }

    @Test
    void historyRecordsChangesButNotNoOpsOrRejectedUpdates() throws Exception {
        String id = createRequestAndGetId();
        UUID requestId = UUID.fromString(id);
        String path = "/api/requests/" + id;
        assertEquals(200, patch(path + "/assignment", "{\"assignee\":\"Alex\"}").statusCode());
        assertEquals(200, patch(path + "/priority", "{\"priority\":\"HIGH\"}").statusCode());
        assertEquals(200, patch(path + "/status", "{\"status\":\"IN_PROGRESS\"}").statusCode());
        assertEquals(200, put(path, "{\"title\":\"Edited title\",\"description\":\"Edited details\"}").statusCode());
        assertEquals(6, historyCount(requestId));
        assertEquals(200, patch(path + "/assignment", "{\"assignee\":\" Alex \"}").statusCode());
        assertEquals(200, patch(path + "/priority", "{\"priority\":\"HIGH\"}").statusCode());
        assertEquals(200, patch(path + "/status", "{\"status\":\"IN_PROGRESS\"}").statusCode());
        assertEquals(200, put(path, "{\"title\":\"Edited title\",\"description\":\"Edited details\"}").statusCode());
        assertEquals(400, patch(path + "/status", "{\"status\":\"NEW\"}").statusCode());
        assertEquals(6, historyCount(requestId));
        var entries = service.findHistory(requestId, null, 25).items();
        assertEquals("DESCRIPTION", entries.getFirst().field());
        assertEquals("Status update test.", entries.getFirst().oldValue());
        assertEquals("Edited details", entries.getFirst().newValue());
        assertEquals("CREATED", entries.getLast().field());
        HttpResponse<String> history = get(path + "/history");
        assertEquals(200, history.statusCode());
        assertTrue(history.body().contains("\"field\":\"ASSIGNEE\""));
        assertEquals(404, get("/api/requests/" + UUID.randomUUID() + "/history").statusCode());
    }

    @Test
    void assignmentRollsBackWhenHistoryCannotBeWritten() throws Exception {
        UUID id = UUID.fromString(createRequestAndGetId());
        doThrow(new IllegalStateException("History unavailable"))
                .when(repository).recordChange(eq(id), eq("ASSIGNEE"), isNull(), eq("Alex"));
        assertThrows(IllegalStateException.class, () -> service.updateAssignment(id, "Alex"));
        assertEquals(null, service.findById(id).assignee());
        assertEquals(1, historyCount(id));
    }

    private int historyCount(UUID id) {
        return jdbc.queryForObject("SELECT count(*) FROM request_history WHERE request_id = ?",
                Integer.class, id);
    }

    private String createRequestAndGetId() throws Exception {
        String title = "Status test " + UUID.randomUUID();
        String json = "{\"title\":\"" + title
                + "\",\"description\":\"Status update test.\"}";

        HttpResponse<String> created = post("/api/requests", json);
        assertEquals(201, created.statusCode());

        var matcher = ID_PATTERN.matcher(created.body());
        assertTrue(matcher.find(), created.body());
        return matcher.group(1);
    }

    private HttpResponse<String> get(String path) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + port + path))
                .timeout(Duration.ofSeconds(5))
                .GET()
                .build();

        return CLIENT.send(request, HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> post(String path, String json) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + port + path))
                .timeout(Duration.ofSeconds(5))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();

        return CLIENT.send(request, HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> put(String path, String json) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + port + path))
                .timeout(Duration.ofSeconds(5))
                .header("Content-Type", "application/json")
                .PUT(HttpRequest.BodyPublishers.ofString(json))
                .build();

        return CLIENT.send(request, HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> patch(String path, String json) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + port + path))
                .timeout(Duration.ofSeconds(5))
                .header("Content-Type", "application/json")
                .method("PATCH", HttpRequest.BodyPublishers.ofString(json))
                .build();

        return CLIENT.send(request, HttpResponse.BodyHandlers.ofString());
    }
}
