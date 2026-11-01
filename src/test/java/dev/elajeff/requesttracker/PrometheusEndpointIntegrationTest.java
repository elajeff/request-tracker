package dev.elajeff.requesttracker;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.micrometer.metrics.test.autoconfigure.AutoConfigureMetrics;
import org.springframework.boot.test.context.SpringBootTest;
import tools.jackson.databind.json.JsonMapper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

// Health endpoints are covered in AuthenticationIntegrationTest and ReadinessEndpointIntegrationTest.
@AutoConfigureMetrics
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "server.servlet.session.cookie.secure=false")
class PrometheusEndpointIntegrationTest extends SupportApiTest {
    @Value("${local.server.port}") private int port;
    @Autowired private JsonMapper json;

    @Test
    void prometheusEndpointExportsHttpAndJvmMetrics() throws Exception {
        assertEquals(200, CLIENT.send("GET", "/api/requests", null).statusCode());
        var metrics = new ApiSession(port, json).send("GET", "/actuator/prometheus", null);
        assertEquals(200, metrics.statusCode());
        assertTrue(metrics.body().contains("http_server_requests_seconds_count"));
        assertTrue(metrics.body().contains("jvm_memory_used_bytes"));
    }
}
