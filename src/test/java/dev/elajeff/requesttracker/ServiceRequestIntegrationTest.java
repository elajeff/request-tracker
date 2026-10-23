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
}