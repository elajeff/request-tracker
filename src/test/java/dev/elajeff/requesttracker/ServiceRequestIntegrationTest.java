package dev.elajeff.requesttracker;

import java.net.http.HttpResponse;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import dev.elajeff.requesttracker.requests.ServiceRequestRepository;
import dev.elajeff.requesttracker.requests.ServiceRequestService;
import dev.elajeff.requesttracker.staff.StaffService;
import org.springframework.boot.test.context.SpringBootTest;
import tools.jackson.databind.json.JsonMapper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "server.servlet.session.cookie.secure=false")
class ServiceRequestIntegrationTest extends SupportApiTest {

    @Autowired
    private JsonMapper json;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private ServiceRequestService service;

    @Autowired
    private StaffService staff;

    @MockitoSpyBean
    private ServiceRequestRepository repository;

    @Test
    void createRequestCanBeRetrievedAndListed() throws Exception {
        String title = "Laptop access " + UUID.randomUUID();
        String description = "Set up access for a new employee.";
        String body = "{\"title\":\"" + title
                + "\",\"description\":\"" + description + "\"}";

        HttpResponse<String> created = CLIENT.send("POST", "/api/requests", body);

        assertEquals(201, created.statusCode());
        assertTrue(created.body().contains(title), created.body());
        assertTrue(created.body().contains("\"status\":\"NEW\""), created.body());
        assertTrue(created.body().contains("\"priority\":\"MEDIUM\""), created.body());

        String id = json.readTree(created.body()).get("id").asText();

        HttpResponse<String> retrieved = CLIENT.send("GET", "/api/requests/" + id, null);

        assertEquals(200, retrieved.statusCode());
        assertTrue(retrieved.body().contains(title), retrieved.body());
        assertTrue(retrieved.body().contains(description), retrieved.body());

        HttpResponse<String> listed = CLIENT.send("GET", "/api/requests", null);

        assertEquals(200, listed.statusCode());
        assertTrue(listed.body().contains(id), listed.body());

        assertEquals(400, CLIENT.send("POST", "/api/requests",
                "{\"title\":\"   \",\"description\":\"A valid description.\"}").statusCode());
        assertEquals(404, CLIENT.send("GET", "/api/requests/" + UUID.randomUUID(), null).statusCode());
    }

    @Test
    void requestDetailsCanBeEditedAndPersisted() throws Exception {
        String id = createRequestAndGetId();
        String title = "Updated request " + UUID.randomUUID();
        String description = "Updated description.";

        HttpResponse<String> updated = CLIENT.send("PUT", "/api/requests/" + id,
                "{\"title\":\"" + title
                        + "\",\"description\":\"" + description + "\"}");

        assertEquals(200, updated.statusCode());
        assertTrue(updated.body().contains(title), updated.body());
        assertTrue(updated.body().contains(description), updated.body());

        HttpResponse<String> retrieved = CLIENT.send("GET", "/api/requests/" + id, null);
        assertTrue(retrieved.body().contains(title), retrieved.body());
        assertTrue(retrieved.body().contains(description), retrieved.body());

        HttpResponse<String> invalid = CLIENT.send("PUT", "/api/requests/" + id,
                "{\"title\":\"   \",\"description\":\"Valid description.\"}");
        assertEquals(400, invalid.statusCode());

        HttpResponse<String> missing = CLIENT.send("PUT", "/api/requests/" + UUID.randomUUID(),
                "{\"title\":\"Missing request\",\"description\":\"Valid description.\"}");
        assertEquals(404, missing.statusCode());
    }
    @Test
    void priorityCanBeSetAndUpdated() throws Exception {
        String title = "Urgent access " + UUID.randomUUID();
        String body = "{\"title\":\"" + title
                + "\",\"description\":\"Access needed.\",\"priority\":\"HIGH\"}";

        HttpResponse<String> created = CLIENT.send("POST", "/api/requests", body);
        assertEquals(201, created.statusCode());
        assertTrue(created.body().contains("\"priority\":\"HIGH\""), created.body());

        String id = json.readTree(created.body()).get("id").asText();

        HttpResponse<String> updated = CLIENT.send("PATCH", "/api/requests/" + id + "/priority",
                "{\"priority\":\"LOW\"}");

        assertEquals(200, updated.statusCode());
        assertTrue(updated.body().contains("\"priority\":\"LOW\""), updated.body());

        HttpResponse<String> retrieved = CLIENT.send("GET", "/api/requests/" + id, null);
        assertTrue(retrieved.body().contains("\"priority\":\"LOW\""), retrieved.body());

        HttpResponse<String> invalid = CLIENT.send("PATCH", "/api/requests/" + id + "/priority",
                "{\"priority\":\"URGENT\"}");

        assertEquals(400, invalid.statusCode());
    }

    @Test
    void statusMovesForwardAndIsPersisted() throws Exception {
        String id = createRequestAndGetId();

        assertEquals(409, CLIENT.send("PATCH", "/api/requests/" + id + "/status",
                "{\"status\":\"RESOLVED\"}").statusCode());

        HttpResponse<String> inProgress = CLIENT.send("PATCH", "/api/requests/" + id + "/status",
                "{\"status\":\"IN_PROGRESS\"}");

        assertEquals(200, inProgress.statusCode());
        assertTrue(inProgress.body().contains("\"status\":\"IN_PROGRESS\""),
                inProgress.body());

        HttpResponse<String> retrieved = CLIENT.send("GET", "/api/requests/" + id, null);
        assertTrue(retrieved.body().contains("\"status\":\"IN_PROGRESS\""),
                retrieved.body());

        HttpResponse<String> resolved = CLIENT.send("PATCH", "/api/requests/" + id + "/status",
                "{\"status\":\"RESOLVED\"}");

        assertEquals(200, resolved.statusCode());
        assertTrue(resolved.body().contains("\"status\":\"RESOLVED\""),
                resolved.body());

        retrieved = CLIENT.send("GET", "/api/requests/" + id, null);
        assertTrue(retrieved.body().contains("\"status\":\"RESOLVED\""),
                retrieved.body());

        assertEquals(400, CLIENT.send("PATCH", "/api/requests/" + id + "/status",
                "{\"status\":\"CLOSED\"}").statusCode());
        assertEquals(404, CLIENT.send("PATCH", "/api/requests/" + UUID.randomUUID() + "/status",
                "{\"status\":\"IN_PROGRESS\"}").statusCode());
        assertEquals(404, CLIENT.send("PATCH", "/api/requests/" + UUID.randomUUID() + "/assignment",
                assignment(UUID.randomUUID())).statusCode());
    }

    @Test
    void historyRecordsChangesButNotNoOpsOrRejectedUpdates() throws Exception {
        String id = createRequestAndGetId();
        UUID requestId = UUID.fromString(id);
        String path = "/api/requests/" + id;
        UUID alex = staff.create("Alex").id();
        assertEquals(200, CLIENT.send("PATCH", path + "/assignment", assignment(alex)).statusCode());
        assertEquals(200, CLIENT.send("PATCH", path + "/priority", "{\"priority\":\"HIGH\"}").statusCode());
        assertEquals(200, CLIENT.send("PATCH", path + "/status", "{\"status\":\"IN_PROGRESS\"}").statusCode());
        assertEquals(200, CLIENT.send("PUT", path, "{\"title\":\"Edited title\",\"description\":\"Edited details\"}").statusCode());
        assertEquals(6, historyCount(requestId));
        assertEquals(200, CLIENT.send("PATCH", path + "/assignment", assignment(alex)).statusCode());
        assertEquals(200, CLIENT.send("PATCH", path + "/priority", "{\"priority\":\"HIGH\"}").statusCode());
        assertEquals(200, CLIENT.send("PATCH", path + "/status", "{\"status\":\"IN_PROGRESS\"}").statusCode());
        assertEquals(200, CLIENT.send("PUT", path, "{\"title\":\"Edited title\",\"description\":\"Edited details\"}").statusCode());
        assertEquals(409, CLIENT.send("PATCH", path + "/status", "{\"status\":\"NEW\"}").statusCode());
        assertEquals(6, historyCount(requestId));
        var entries = service.findHistory(requestId, null, 25).items();
        assertEquals("DESCRIPTION", entries.getFirst().field());
        assertEquals("Status update test.", entries.getFirst().oldValue());
        assertEquals("Edited details", entries.getFirst().newValue());
        assertEquals("CREATED", entries.getLast().field());
        HttpResponse<String> history = CLIENT.send("GET", path + "/history", null);
        assertEquals(200, history.statusCode());
        assertTrue(history.body().contains("\"field\":\"ASSIGNEE\""));
        assertEquals(404, CLIENT.send("GET", "/api/requests/" + UUID.randomUUID() + "/history", null).statusCode());
    }

    @Test
    void assignmentRollsBackWhenHistoryCannotBeWritten() throws Exception {
        UUID id = UUID.fromString(createRequestAndGetId());
        UUID alex = staff.create("Alex").id();
        doThrow(new IllegalStateException("History unavailable"))
                .when(repository).recordChange(eq(id), eq("ASSIGNEE"), isNull(), eq("Alex [" + alex + "]"), org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
        assertThrows(IllegalStateException.class, () -> service.updateAssignment(id, alex));
        assertEquals(null, service.findById(id).assignee());
        assertEquals(1, historyCount(id));
    }

    private int historyCount(UUID id) {
        return jdbc.queryForObject("SELECT count(*) FROM request_history WHERE request_id = ?",
                Integer.class, id);
    }

    private String assignment(UUID id) {
        return "{\"staffId\":\"" + id + "\"}";
    }

    private String createRequestAndGetId() throws Exception {
        String title = "Status test " + UUID.randomUUID();
        String body = "{\"title\":\"" + title
                + "\",\"description\":\"Status update test.\"}";

        HttpResponse<String> created = CLIENT.send("POST", "/api/requests", body);
        assertEquals(201, created.statusCode());

        return json.readTree(created.body()).get("id").asText();
    }
}
