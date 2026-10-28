package dev.elajeff.requesttracker;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthContributor;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.health.registry.HealthContributorRegistry;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "spring.flyway.enabled=false")
class ReadinessEndpointIntegrationTest {

    @Value("${local.server.port}")
    private int port;

    @Autowired
    private HealthContributorRegistry healthContributors;

    @Test
    void readinessTracksDatabaseFailureAndRecoveryWithoutFailingLiveness() throws Exception {
        HealthContributor original = healthContributors.unregisterContributor("db");
        assertNotNull(original, "The application must register its database health contributor");
        AtomicReference<Health> databaseHealth = new AtomicReference<>(Health.up().build());
        healthContributors.registerContributor("db", (HealthIndicator) databaseHealth::get);
        try {
            assertHealth("readiness", 200, "UP");

            databaseHealth.set(Health.down().build());
            assertHealth("readiness", 503, "DOWN");
            assertHealth("liveness", 200, "UP");

            databaseHealth.set(Health.up().build());
            assertHealth("readiness", 200, "UP");
        } finally {
            healthContributors.unregisterContributor("db");
            healthContributors.registerContributor("db", original);
        }
    }

    private void assertHealth(String group, int statusCode, String status) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + port + "/actuator/health/" + group))
                .timeout(Duration.ofSeconds(5))
                .GET()
                .build();
        HttpResponse<String> response = HttpClient.newHttpClient()
                .send(request, HttpResponse.BodyHandlers.ofString());

        assertEquals(statusCode, response.statusCode(), response.body());
        assertEquals("{\"status\":\"" + status + "\"}", response.body());
    }
}
