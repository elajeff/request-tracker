package dev.elajeff.requesttracker;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.micrometer.metrics.test.autoconfigure.AutoConfigureMetrics;
import org.springframework.boot.test.context.SpringBootTest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

@AutoConfigureMetrics
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "server.servlet.session.cookie.secure=false")
class HealthEndpointIntegrationTest extends SupportApiTest {

    @Value("${local.server.port}")
    private int port;

    @Test
    void healthEndpointReturnsUp() throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + port + "/actuator/health"))
                .timeout(Duration.ofSeconds(5))
                .GET()
                .build();

        HttpResponse<String> response = HttpClient.newHttpClient()
                .send(request, HttpResponse.BodyHandlers.ofString());

        assertEquals(200, response.statusCode());
        assertTrue(response.body().contains("\"status\":\"UP\""), response.body());
    }
    @Test
    void prometheusEndpointExportsHttpMetrics() throws Exception {
        HttpClient client = HttpClient.newHttpClient();

        HttpRequest apiRequest = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + port + "/api/requests"))
                .timeout(Duration.ofSeconds(5))
                .GET()
                .build();

        HttpResponse<String> apiResponse = CLIENT.send(
                apiRequest, HttpResponse.BodyHandlers.ofString());
        assertEquals(200, apiResponse.statusCode());

        HttpRequest metricsRequest = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + port + "/actuator/prometheus"))
                .timeout(Duration.ofSeconds(5))
                .GET()
                .build();

        HttpResponse<String> metricsResponse = client.send(
                metricsRequest, HttpResponse.BodyHandlers.ofString());

        assertEquals(200, metricsResponse.statusCode());
        assertTrue(metricsResponse.body().contains(
                "http_server_requests_seconds_count"));
        assertTrue(metricsResponse.body().contains("jvm_memory_used_bytes"));
    }

}
