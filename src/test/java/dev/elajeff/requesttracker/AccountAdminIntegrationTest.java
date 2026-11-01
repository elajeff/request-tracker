package dev.elajeff.requesttracker;

import java.net.http.HttpResponse;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;
import dev.elajeff.requesttracker.security.AccountAdministration;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "server.servlet.session.cookie.secure=false")
class AccountAdminIntegrationTest extends SupportApiTest {
    @Value("${local.server.port}") private int port;
    @Autowired private JsonMapper json;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private AccountAdministration accounts;
    @Autowired private TransactionTemplate transactions;

    @Test
    void supportCreatesListsAndDisablesAccounts() throws Exception {
        String name = username();
        String password = password();
        var created = send("POST", "/api/accounts", Map.of("username", name, "role", "REQUESTER", "password", password));
        assertEquals(201, created.statusCode(), created.body());
        assertEquals("/api/accounts/" + name, created.headers().firstValue("Location").orElseThrow());
        assertFalse(created.body().contains("password"));
        JsonNode account = json.readTree(created.body());
        assertEquals("REQUESTER", account.get("role").asText());
        assertTrue(account.get("enabled").asBoolean());

        JsonNode page = read(send("GET", "/api/accounts?q=" + name.toUpperCase(), null));
        assertEquals(1, page.get("items").size());
        assertEquals(name, page.get("items").get(0).get("username").asText());
        assertFalse(page.toString().contains("password"));

        var user = login(name, password);
        assertFalse(read(send("PATCH", "/api/accounts/" + name + "/enabled", Map.of("enabled", false))).get("enabled").asBoolean());
        assertEquals(401, user.send("GET", "/api/requests", null).statusCode());
        assertEquals(401, new ApiSession(port, json).login(name, password).statusCode());
        assertTrue(read(send("PATCH", "/api/accounts/" + name + "/enabled", Map.of("enabled", true))).get("enabled").asBoolean());
        login(name, password);
    }

    @Test
    void roleChangesAndPasswordResetsEndExistingSessions() throws Exception {
        String name = username();
        String password = password();
        accounts.create(name, "REQUESTER", password);
        var user = login(name, password);
        assertEquals(403, user.send("GET", "/api/staff", null).statusCode());

        assertEquals("SUPPORT", read(send("PATCH", "/api/accounts/" + name + "/role", Map.of("role", "SUPPORT"))).get("role").asText());
        assertEquals(401, user.send("GET", "/api/requests", null).statusCode());
        assertEquals(200, login(name, password).send("GET", "/api/staff", null).statusCode());

        var current = login(name, password);
        String newPassword = password();
        assertEquals(204, send("PUT", "/api/accounts/" + name + "/password", Map.of("password", newPassword)).statusCode());
        assertEquals(401, current.send("GET", "/api/requests", null).statusCode());
        assertEquals(401, new ApiSession(port, json).login(name, password).statusCode());
        login(name, newPassword);
        String hash = jdbc.queryForObject("SELECT password_hash FROM login_accounts WHERE username=?", String.class, name);
        assertTrue(hash.startsWith("{bcrypt}"));
    }

    @Test
    void invalidInputUnknownAccountsAndDuplicatesAreRejected() throws Exception {
        String name = username();
        accounts.create(name, "REQUESTER", password());
        assertEquals(409, send("POST", "/api/accounts", Map.of("username", name, "role", "REQUESTER", "password", password())).statusCode());
        for (Object body : List.of(
                Map.of("username", "Bad Name", "role", "REQUESTER", "password", password()),
                Map.of("username", username(), "role", "ADMIN", "password", password()),
                Map.of("username", username(), "role", "REQUESTER", "password", "short"),
                Map.of())) {
            assertEquals(400, send("POST", "/api/accounts", body).statusCode());
        }
        assertEquals(400, send("PATCH", "/api/accounts/" + name + "/role", Map.of("role", "ADMIN")).statusCode());
        assertEquals(400, send("PATCH", "/api/accounts/" + name + "/enabled", Map.of()).statusCode());
        assertEquals(400, send("PUT", "/api/accounts/" + name + "/password", Map.of("password", "short")).statusCode());
        String missing = username();
        assertEquals(404, send("PATCH", "/api/accounts/" + missing + "/enabled", Map.of("enabled", false)).statusCode());
        assertEquals(404, send("PATCH", "/api/accounts/" + missing + "/role", Map.of("role", "SUPPORT")).statusCode());
        assertEquals(404, send("PUT", "/api/accounts/" + missing + "/password", Map.of("password", password())).statusCode());
        for (String query : List.of("limit=0", "limit=101", "cursor=Bad")) {
            assertEquals(400, send("GET", "/api/accounts?" + query, null).statusCode());
        }
        JsonNode first = read(send("GET", "/api/accounts?limit=1", null));
        JsonNode second = read(send("GET", "/api/accounts?limit=1&cursor=" + first.get("nextCursor").asText(), null));
        assertTrue(first.get("items").get(0).get("username").asText()
                .compareTo(second.get("items").get(0).get("username").asText()) < 0);
    }

    @Test
    void requestersCannotUseTheAccountApi() throws Exception {
        String name = username();
        String password = password();
        accounts.create(name, "REQUESTER", password);
        var requester = login(name, password);
        assertEquals(403, requester.send("GET", "/api/accounts", null).statusCode());
        assertEquals(403, requester.send("PATCH", "/api/accounts/" + name + "/role",
                json.writeValueAsString(Map.of("role", "SUPPORT"))).statusCode());
        assertEquals(401, new ApiSession(port, json).send("GET", "/api/accounts", null).statusCode());
    }

    @Test
    void theLastActiveSupportAccountCannotBeDisabledOrDemoted() {
        String last = username();
        accounts.create(last, "SUPPORT", password());
        // Other tests leave SUPPORT accounts behind, so switch them off here and roll everything back afterwards.
        transactions.executeWithoutResult(status -> {
            jdbc.update("UPDATE login_accounts SET enabled = false WHERE role = 'SUPPORT' AND username <> ?", last);
            var disable = assertThrows(ResponseStatusException.class, () -> accounts.setEnabled(last, false));
            assertEquals(409, disable.getStatusCode().value());
            var demote = assertThrows(ResponseStatusException.class, () -> accounts.changeRole(last, "REQUESTER"));
            assertEquals(409, demote.getStatusCode().value());
            accounts.setEnabled(last, true);
            accounts.changeRole(last, "SUPPORT");
            status.setRollbackOnly();
        });
        // With another SUPPORT account active, the same changes are allowed.
        accounts.setEnabled(last, false);
        accounts.setEnabled(last, true);
        accounts.changeRole(last, "REQUESTER");
    }

    private HttpResponse<String> send(String method, String path, Object body) throws Exception {
        return CLIENT.send(method, path, body == null ? null : json.writeValueAsString(body));
    }

    private JsonNode read(HttpResponse<String> response) throws Exception {
        assertEquals(200, response.statusCode(), response.body());
        return json.readTree(response.body());
    }

    private ApiSession login(String name, String password) throws Exception {
        var client = new ApiSession(port, json);
        assertEquals(204, client.login(name, password).statusCode());
        return client;
    }

    private String username() { return "user-" + UUID.randomUUID(); }

    private String password() { return UUID.randomUUID().toString(); }
}
