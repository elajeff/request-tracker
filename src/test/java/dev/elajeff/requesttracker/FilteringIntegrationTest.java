package dev.elajeff.requesttracker;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import dev.elajeff.requesttracker.security.AccountAdministration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "server.servlet.session.cookie.secure=false")
class FilteringIntegrationTest extends SupportApiTest {
    @Autowired JdbcTemplate jdbc;
    @Autowired JsonMapper json;
    @Autowired AccountAdministration accounts;
    @Value("${local.server.port}") int port;

    @Test
    void statusFiltersBeforePaginationAndKeepsBoundariesAcrossArrivals() throws Exception {
        String token = UUID.randomUUID().toString();
        for (int i = 0; i < 32; i++) insert(token, "IN_PROGRESS", null, null, i);
        for (int i = 0; i < 28; i++) insert(token, "NEW", null, null, 100 + i);
        String path = "/api/requests?q=" + token + "&status=IN_PROGRESS&limit=25";
        JsonNode first = page(CLIENT, path);
        assertEquals(25, ids(first).size());
        insert(token, "IN_PROGRESS", null, null, 200);
        insert(token, "RESOLVED", null, null, 201);
        JsonNode last = page(CLIENT, path + "&cursor=" + first.get("nextCursor").asText());
        assertEquals(7, ids(last).size());
        var all = new ArrayList<>(ids(first)); all.addAll(ids(last));
        assertEquals(32, all.stream().distinct().count());
        assertTrue(last.get("nextCursor").isNull());
        for (JsonNode item : first.get("items")) assertEquals("IN_PROGRESS", item.get("status").asText());
        assertEquals(33, collect(CLIENT, path).size());
    }

    @Test
    void statusCombinesWithTextStaffAndUnassignedPredicates() throws Exception {
        String token = UUID.randomUUID().toString(); UUID staff = person("Assigned filter staff", true);
        String assigned = insert(token, "RESOLVED", staff, null, 1);
        String unassigned = insert(token, "RESOLVED", null, null, 2);
        insert(token, "NEW", staff, null, 3); insert("other", "RESOLVED", staff, null, 4);
        String path = "/api/requests?q=" + token + "&status=RESOLVED";
        assertEquals(List.of(assigned), ids(page(CLIENT, path + "&staffId=" + staff)));
        assertEquals(List.of(unassigned), ids(page(CLIENT, path + "&unassigned=true")));
        assertEquals(400, CLIENT.send("GET", path + "&staffId=" + staff + "&unassigned=true", null).statusCode());
    }

    @Test
    void statusPreservesRequesterOwnershipAndStaffAuthorization() throws Exception {
        String username = "filter-" + UUID.randomUUID(); String password = UUID.randomUUID().toString();
        accounts.create(username, "REQUESTER", password);
        UUID owner = jdbc.queryForObject("SELECT id FROM login_accounts WHERE username=?", UUID.class, username);
        String token = UUID.randomUUID().toString(); UUID staff = person("Owner filter staff", true);
        String own = insert(token, "NEW", staff, owner, 1);
        insert(token, "NEW", staff, null, 2);
        String progress = insert(token, "IN_PROGRESS", null, owner, 3);
        insert(token, "IN_PROGRESS", null, null, 4);
        ApiSession requester = new ApiSession(port, json); assertEquals(204, requester.login(username, password).statusCode());
        assertEquals(List.of(own), ids(page(requester, "/api/requests?q=" + token + "&status=NEW")));
        assertEquals(2, ids(page(CLIENT, "/api/requests?q=" + token + "&status=NEW")).size());
        assertEquals(List.of(own), ids(page(requester, "/api/requests?q=" + token + "&status=NEW&staffId=" + staff)));
        assertEquals(List.of(progress), ids(page(requester, "/api/requests?q=" + token + "&status=IN_PROGRESS&unassigned=true")));
        assertEquals(403, requester.send("GET", "/api/staff?q=anything", null).statusCode());
        assertEquals(401, new ApiSession(port, json).send("GET", "/api/requests?status=NEW", null).statusCode());
    }

    @Test
    void invalidStatusUsesBadRequestAndOmittedStatusRemainsCompatible() throws Exception {
        for (String invalid : List.of("", "%20", "%20NEW%20", "invalid", "new", "IN%20PROGRESS")) {
            var response = CLIENT.send("GET", "/api/requests?status=" + invalid, null);
            assertEquals(400, response.statusCode());
            assertEquals(400, json.readTree(response.body()).get("status").asInt());
        }
        assertEquals(200, CLIENT.send("GET", "/api/requests", null).statusCode());
    }

    @Test
    void staffSearchTrimsMatchesLiterallyAndPaginatesActiveAndInactiveRows() throws Exception {
        String token = "Search%_\\" + UUID.randomUUID(); List<String> expected = new ArrayList<>();
        for (int i = 0; i < 31; i++) expected.add(person(token + " " + i, i % 2 == 0).toString());
        person("unrelated", true); expected.sort(String::compareTo);
        String path = "/api/staff?q=" + URLEncoder.encode("  " + token.toUpperCase() + "  ", StandardCharsets.UTF_8) + "&limit=10";
        JsonNode first = page(CLIENT, path); assertEquals(expected.subList(0, 10), ids(first));
        // UUID order has no creation-time snapshot: inserts before the cursor stay behind it.
        UUID before = UUID.fromString("00000000-0000-0000-0000-000000000001");
        jdbc.update("INSERT INTO support_staff(id,name) VALUES (?,?)", before, token);
        UUID after = UUID.fromString("ffffffff-ffff-ffff-ffff-ffffffffffff");
        jdbc.update("INSERT INTO support_staff(id,name) VALUES (?,?)", after, token);
        expected.add(after.toString());
        person("nonmatching arrival", true);
        List<String> all = new ArrayList<>(ids(first)); String cursor = first.get("nextCursor").asText();
        while (cursor != null) {
            JsonNode next = page(CLIENT, path + "&cursor=" + cursor); all.addAll(ids(next));
            cursor = next.get("nextCursor").isNull() ? null : next.get("nextCursor").asText();
        }
        assertEquals(expected, all);
        assertEquals(33, collect(CLIENT, "/api/staff?q=%25_&limit=10").size());
        JsonNode matches = page(CLIENT, path.replace("limit=10", "limit=100"));
        assertTrue(matches.get("items").valueStream().anyMatch(x -> !x.get("active").asBoolean()));
        assertEquals(ids(page(CLIENT, "/api/staff?limit=100")), ids(page(CLIENT, "/api/staff?q=%20%20&limit=100")));
    }

    private UUID person(String name, boolean active) {
        UUID id = UUID.randomUUID(); jdbc.update("INSERT INTO support_staff(id,name,active) VALUES (?,?,?)", id, name, active); return id;
    }
    private String insert(String title, String status, UUID staff, UUID owner, int offset) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO service_requests(id,title,description,status,assignee_id,owner_id,created_at) VALUES (?,?,'Details',?,?,?,timestamptz '2026-01-01' + ? * interval '1 second')", id, title, status, staff, owner, offset);
        return id.toString();
    }
    private JsonNode page(ApiSession client, String path) throws Exception {
        var response = client.send("GET", path, null); assertEquals(200, response.statusCode(), response.body()); return json.readTree(response.body());
    }
    private List<String> ids(JsonNode page) {
        List<String> ids = new ArrayList<>(); page.get("items").forEach(x -> ids.add(x.get("id").asText())); return ids;
    }
    private List<String> collect(ApiSession client, String path) throws Exception {
        List<String> result = new ArrayList<>(); String cursor = null;
        do { JsonNode p = page(client, path + (cursor == null ? "" : "&cursor=" + cursor)); result.addAll(ids(p)); cursor = p.get("nextCursor").isNull() ? null : p.get("nextCursor").asText(); } while (cursor != null);
        return result;
    }
}
