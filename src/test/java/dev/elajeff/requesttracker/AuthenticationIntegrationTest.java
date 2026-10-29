package dev.elajeff.requesttracker;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
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
import dev.elajeff.requesttracker.security.AccountAdministration;
import tools.jackson.databind.json.JsonMapper;

import static org.junit.jupiter.api.Assertions.*;

@org.springframework.boot.micrometer.metrics.test.autoconfigure.AutoConfigureMetrics
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "server.servlet.session.cookie.secure=false")
class AuthenticationIntegrationTest {
    @Value("${local.server.port}") private int port;
    @Autowired private AccountAdministration accounts;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private JsonMapper json;
    @Autowired private DataSource dataSource;

    @Test
    void loginRotatesSessionAndLogoutRequiresCsrfAndInvalidatesIt() throws Exception {
        var client = new ApiSession(port, json);
        assertTrue(client.session().get("user").isNull());
        String initialCookie = cookie(client);
        String username = username();
        String password = UUID.randomUUID().toString();
        accounts.create(username, "REQUESTER", password);
        var login = client.login(username, password);
        assertEquals(204, login.statusCode());
        assertTrue(!initialCookie.equals(cookie(client)), "Login must rotate the session identifier");
        assertEquals(username, client.session().get("user").get("username").asText());
        String sessionCookie = login.headers().allValues("set-cookie").toString();
        assertTrue(sessionCookie.contains("HttpOnly"));
        assertTrue(sessionCookie.contains("SameSite=Lax"));
        assertEquals(403, raw(client, "POST", "/api/session/logout", null, null).statusCode());
        assertEquals(204, client.send("POST", "/api/session/logout", null).statusCode());
        assertEquals(401, client.send("GET", "/api/requests", null).statusCode());
        assertTrue(client.session().get("user").isNull());
    }

    @Test
    void genericLoginErrorsAndDisabledSessionsDoNotDiscloseAccountState() throws Exception {
        String username = username();
        String password = UUID.randomUUID().toString();
        accounts.create(username, "REQUESTER", password);
        var first = new ApiSession(port, json);
        var second = new ApiSession(port, json);
        assertEquals(204, first.login(username, password).statusCode());
        assertEquals(204, second.login(username, password).statusCode());
        accounts.disable(username);
        for (var client : List.of(first, second)) {
            assertEquals(401, client.send("GET", "/api/requests", null).statusCode());
        }
        var errors = new ApiSession(port, json);
        var disabled = errors.login(username, password);
        var missing = errors.login(username(), password);
        var wrong = errors.login(username, UUID.randomUUID().toString());
        assertEquals(401, disabled.statusCode());
        assertEquals(disabled.statusCode(), missing.statusCode());
        assertEquals(disabled.body(), missing.body());
        assertEquals(disabled.body(), wrong.body());
        // Direct database deactivation must also invalidate an already authenticated session.
        var live = account("REQUESTER");
        String name = live.session().get("user").get("username").asText();
        assertEquals(disabled.body(), errors.login(name, UUID.randomUUID().toString()).body());
        jdbc.update("UPDATE login_accounts SET enabled=false WHERE username=?", name);
        assertEquals(401, live.send("GET", "/api/session", null).statusCode());
    }

    @Test
    void authenticationAndCsrfProtectAllMutationsIncludingLogin() throws Exception {
        var anonymous = new ApiSession(port, json);
        assertEquals(401, anonymous.send("GET", "/api/requests", null).statusCode());
        assertEquals(401, anonymous.send("GET", "/api/staff", null).statusCode());
        assertEquals(403, raw(anonymous, "POST", "/api/session/login", "username=missing&password=missing", null).statusCode());
        var support = account("SUPPORT");
        for (String csrf : new String[] {null, "invalid"}) {
            assertEquals(403, raw(support, "POST", "/api/requests", "{\"title\":\"Blocked\",\"description\":\"Blocked\"}", csrf).statusCode());
        }
        String id = create(support, "CSRF target");
        for (var call : List.of(List.of("PUT", "/api/requests/" + id),
                List.of("PATCH", "/api/requests/" + id + "/priority"), List.of("POST", "/api/staff"))) {
            assertEquals(403, raw(support, call.get(0), call.get(1), "{}", null).statusCode());
        }
        assertEquals(200, support.send("GET", "/api/requests/" + id, null).statusCode());
    }

    @Test
    void requesterCannotManipulateOwnershipRolesPriorityOrSupportOperations() throws Exception {
        var requester = account("REQUESTER");
        var other = account("REQUESTER");
        String id = create(requester, "Owned");
        String owner = requester.session().get("user").get("id").asText();
        assertEquals(owner, jdbc.queryForObject("SELECT owner_id::text FROM service_requests WHERE id=?::uuid", String.class, id));
        for (var forged : List.of(Map.of("ownerId", UUID.randomUUID().toString()), Map.of("role", "SUPPORT"), Map.of("status", "RESOLVED"))) {
            var body = new java.util.HashMap<String, String>(forged);
            body.put("title", "Forged");
            body.put("description", "Details");
            assertEquals(400, requester.send("POST", "/api/requests", json.writeValueAsString(body)).statusCode());
        }
        assertEquals(403, requester.send("POST", "/api/requests", "{\"title\":\"Forged\",\"description\":\"Details\",\"priority\":\"HIGH\"}").statusCode());
        assertEquals(400, requester.send("PUT", "/api/requests/" + id,
                "{\"title\":\"Keep owner\",\"description\":\"Details\",\"ownerId\":null}").statusCode());
        for (String path : List.of("/api/staff", "/api/staff/" + UUID.randomUUID())) {
            for (String method : List.of("GET", "POST", "PUT", "PATCH", "DELETE")) {
                assertEquals(403, requester.send(method, path, method.equals("GET") ? null : "{}").statusCode());
            }
        }
        for (String operation : List.of("status", "priority", "assignment")) {
            assertEquals(403, requester.send("PATCH", "/api/requests/" + id + "/" + operation, "{}").statusCode());
        }
        for (String path : List.of("/api/requests/" + id, "/api/requests/" + id + "/history?limit=1&cursor=999999")) {
            assertEquals(404, other.send("GET", path, null).statusCode());
        }
        assertEquals(404, other.send("PUT", "/api/requests/" + id, "{\"title\":\"Attack\",\"description\":\"Attack\"}").statusCode());
    }

    @Test
    void requesterDetailsStopAtNewAndHistoryRecordsActualActorSnapshots() throws Exception {
        var requester = account("REQUESTER");
        var support = account("SUPPORT");
        String id = create(requester, "Original");
        assertEquals(200, requester.send("PUT", "/api/requests/" + id, "{\"title\":\"Edited\",\"description\":\"Changed\"}").statusCode());
        assertEquals(200, support.send("PATCH", "/api/requests/" + id + "/status", "{\"status\":\"IN_PROGRESS\"}").statusCode());
        assertEquals(409, requester.send("PUT", "/api/requests/" + id, "{\"title\":\"Late\",\"description\":\"Late\"}").statusCode());
        var history = json.readTree(requester.send("GET", "/api/requests/" + id + "/history", null).body()).get("items");
        assertEquals(4, history.size());
        assertEquals(support.session().get("user").get("username").asText(), history.get(0).get("actorUsername").asText());
        assertEquals("NEW", history.get(0).get("oldValue").asText());
        assertEquals("IN_PROGRESS", history.get(0).get("newValue").asText());
        assertEquals(requester.session().get("user").get("username").asText(), history.get(3).get("actorUsername").asText());
        assertEquals(200, support.send("PUT", "/api/requests/" + id, "{\"title\":\"Support edit\",\"description\":\"Changed\"}").statusCode());
    }

    @Test
    void ownershipScopesSearchStaffFiltersCountsAndEveryQueueAndHistoryPage() throws Exception {
        var requester = account("REQUESTER");
        var other = account("REQUESTER");
        var support = account("SUPPORT");
        String query = UUID.randomUUID().toString();
        String staff = json.readTree(support.send("POST", "/api/staff", "{\"name\":\"Filter target\"}").body()).get("id").asText();
        List<String> owned = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            String id = create(requester, query);
            owned.add(id);
            assertEquals(200, support.send("PATCH", "/api/requests/" + id + "/assignment", "{\"staffId\":\"" + staff + "\"}").statusCode());
            create(other, query);
        }
        String unassigned = create(requester, query);
        String legacy = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO service_requests(id,title,description) VALUES (?::uuid,?, 'Legacy')", legacy, query);
        jdbc.update("UPDATE service_requests SET created_at='2026-01-01' WHERE title=?", query);
        owned.sort(java.util.Comparator.reverseOrder());
        var found = new ArrayList<String>();
        String cursor = null;
        do {
            String path = "/api/requests?q=" + query + "&staffId=" + staff + "&limit=2&ownerId=" + UUID.randomUUID()
                    + (cursor == null ? "" : "&cursor=" + cursor);
            var page = json.readTree(requester.send("GET", path, null).body());
            assertEquals(6, page.get("counts").get("total").asInt());
            page.get("items").forEach(item -> found.add(item.get("id").asText()));
            cursor = page.get("nextCursor").isNull() ? null : page.get("nextCursor").asText();
        } while (cursor != null);
        assertEquals(owned, found);
        var unassignedPage = json.readTree(requester.send("GET", "/api/requests?q=" + query + "&unassigned=true", null).body());
        assertEquals(1, unassignedPage.get("items").size());
        assertEquals(unassigned, unassignedPage.get("items").get(0).get("id").asText());
        assertEquals(404, requester.send("GET", "/api/requests/" + legacy, null).statusCode());
        assertEquals(200, support.send("GET", "/api/requests/" + legacy, null).statusCode());
        var first = json.readTree(requester.send("GET", "/api/requests/" + owned.getFirst() + "/history?limit=1", null).body());
        assertFalse(first.get("nextCursor").isNull());
        String historyPath = "/api/requests/" + owned.getFirst() + "/history?limit=1&cursor=" + first.get("nextCursor").asText();
        var last = json.readTree(requester.send("GET", historyPath, null).body());
        assertEquals("CREATED", last.get("items").get(0).get("field").asText());
        assertTrue(last.get("nextCursor").isNull());
        assertEquals(404, other.send("GET", historyPath, null).statusCode());
    }

    @Test
    void localOwnershipAssignmentIsExplicitTransactionalAndCannotReplaceAnOwner() throws Exception {
        var requester = account("REQUESTER");
        String username = requester.session().get("user").get("username").asText();
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO service_requests(id,title,description) VALUES (?, 'Legacy', 'Keep')", id);
        accounts.claimLegacy(username, id);
        assertEquals(200, requester.send("GET", "/api/requests/" + id, null).statusCode());
        assertThrows(IllegalArgumentException.class, () -> accounts.claimLegacy(username, id));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM request_history WHERE request_id=?", Integer.class, id));
        assertNull(jdbc.queryForObject("SELECT actor_username FROM request_history WHERE request_id=?", String.class, id));
        assertTrue(jdbc.queryForObject("SELECT new_value FROM request_history WHERE request_id=?", String.class, id).startsWith(username + " ["));
    }

    @Test
    void migrationPreservesLegacyDataWithoutInventingOwnersOrActors() {
        String schema = "auth_migration_" + UUID.randomUUID().toString().replace("-", "");
        try {
            Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).target("5").load().migrate();
            UUID id = UUID.randomUUID();
            UUID staff = UUID.randomUUID();
            jdbc.update("INSERT INTO " + schema + ".support_staff(id,name,active) VALUES (?, 'Preserved staff', false)", staff);
            jdbc.update("INSERT INTO " + schema + ".service_requests(id,title,description,assignee_id) VALUES (?, 'Legacy', 'Unchanged', ?)", id, staff);
            jdbc.update("INSERT INTO " + schema + ".request_history(request_id,field,old_value,new_value) VALUES (?, 'ASSIGNEE', 'Old name', 'Preserved name')", id);
            var before = jdbc.queryForList("SELECT * FROM " + schema + ".service_requests");
            var history = jdbc.queryForList("SELECT id,request_id,field,old_value,new_value,changed_at FROM " + schema + ".request_history");
            Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).load().migrate();
            var after = jdbc.queryForList("SELECT * FROM " + schema + ".service_requests");
            assertNull(after.getFirst().remove("owner_id"));
            assertEquals(before, after);
            assertEquals(history, jdbc.queryForList("SELECT id,request_id,field,old_value,new_value,changed_at FROM " + schema + ".request_history"));
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM " + schema + ".request_history WHERE actor_account_id IS NOT NULL OR actor_username IS NOT NULL", Integer.class));
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM " + schema + ".login_accounts", Integer.class));
            assertEquals("6", jdbc.queryForObject("SELECT version FROM " + schema + ".flyway_schema_history WHERE version='6' AND success", String.class));
        } finally {
            jdbc.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }

    @Test
    void onlyExplicitOperationalReadsAreAnonymousAndHealthHidesComponents() throws Exception {
        var anonymous = new ApiSession(port, json);
        for (String path : List.of("/actuator/health", "/actuator/health/readiness", "/actuator/health/liveness")) {
            var response = anonymous.send("GET", path, null);
            assertEquals(200, response.statusCode());
            assertEquals("UP", json.readTree(response.body()).get("status").asText());
            assertFalse(response.body().contains("components"));
            assertFalse(response.body().contains("details"));
            assertEquals(403, anonymous.send("POST", path, "{}").statusCode());
        }
        assertEquals(200, anonymous.send("GET", "/actuator/prometheus", null).statusCode());
        for (String path : List.of("/actuator/env", "/actuator/health/db", "/actuator", "/error", "/login", "/api/session/login")) {
            assertEquals(401, anonymous.send("GET", path, null).statusCode());
        }
    }

    @Test
    void provisioningValidatesInputsAndStoresOnlyPasswordHashes() {
        String name = username();
        String password = UUID.randomUUID().toString();
        accounts.create(name, "SUPPORT", password);
        String hash = jdbc.queryForObject("SELECT password_hash FROM login_accounts WHERE username=?", String.class, name);
        assertTrue(hash.startsWith("{bcrypt}"));
        assertFalse(hash.contains(password));
        assertThrows(IllegalArgumentException.class, () -> accounts.create(name, "SUPPORT", password));
        assertThrows(IllegalArgumentException.class, () -> accounts.create(username(), "ADMIN", password));
        assertThrows(IllegalArgumentException.class, () -> accounts.create("Invalid Name", "REQUESTER", password));
        assertThrows(IllegalArgumentException.class, () -> accounts.create(username(), "REQUESTER", "short"));
        assertThrows(IllegalArgumentException.class, () -> accounts.create(username(), "REQUESTER", "é".repeat(37)));
    }

    private ApiSession account(String role) throws Exception {
        String name = username();
        String password = UUID.randomUUID().toString();
        accounts.create(name, role, password);
        var client = new ApiSession(port, json);
        assertEquals(204, client.login(name, password).statusCode());
        return client;
    }

    private String create(ApiSession client, String title) throws Exception {
        var response = client.send("POST", "/api/requests", json.writeValueAsString(Map.of("title", title, "description", "Details")));
        assertEquals(201, response.statusCode(), response.body());
        return json.readTree(response.body()).get("id").asText();
    }

    private String username() { return "user-" + UUID.randomUUID(); }

    private String cookie(ApiSession client) {
        return ((java.net.CookieManager) client.client.cookieHandler().orElseThrow()).getCookieStore().getCookies().toString();
    }

    private HttpResponse<String> raw(ApiSession client, String method, String path, String body, String csrf) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                .header("Content-Type", path.endsWith("/login") ? "application/x-www-form-urlencoded" : "application/json")
                .method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        if (csrf != null) request.header("X-CSRF-TOKEN", csrf);
        return client.client.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }
}
