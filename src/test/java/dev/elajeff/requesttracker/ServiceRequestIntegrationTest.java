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
import org.springframework.boot.test.context.SpringBootTest;

import static org.junit.jupiter.api.Assertions.assertEquals;
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
    void statusMovesForwardAndIsPersisted() throws Exception {
        String id = createRequestAndGetId();

        // A request cannot skip directly from NEW to RESOLVED.
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
