package dev.elajeff.requesttracker;

import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ApiSession {
    final HttpClient client = HttpClient.newBuilder()
            .cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL)).build();
    private final String base;
    private final JsonMapper json;
    String csrf;

    ApiSession(int port, JsonMapper json) {
        this.base = "http://127.0.0.1:" + port;
        this.json = json;
    }

    JsonNode session() throws Exception {
        var response = client.send(HttpRequest.newBuilder(URI.create(base + "/api/session")).GET().build(),
                HttpResponse.BodyHandlers.ofString());
        assertEquals(200, response.statusCode());
        var data = json.readTree(response.body());
        csrf = data.get("csrfToken").asText();
        return data;
    }

    HttpResponse<String> login(String username, String password) throws Exception {
        session();
        var response = send("POST", "/api/session/login", "username=" + encode(username) + "&password=" + encode(password),
                "application/x-www-form-urlencoded");
        if (response.statusCode() == 204) session();
        return response;
    }

    HttpResponse<String> send(String method, String path, String body) throws Exception {
        return send(method, path, body, "application/json");
    }

    private HttpResponse<String> send(String method, String path, String body, String contentType) throws Exception {
        var request = HttpRequest.newBuilder(URI.create(base + path)).header("Content-Type", contentType)
                .method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body)).build();
        return send(request, HttpResponse.BodyHandlers.ofString());
    }

    <T> HttpResponse<T> send(HttpRequest original, HttpResponse.BodyHandler<T> handler) throws Exception {
        var request = HttpRequest.newBuilder(original, (name, value) -> !name.equalsIgnoreCase("X-CSRF-TOKEN"));
        if (!original.method().equals("GET") && csrf != null) request.header("X-CSRF-TOKEN", csrf);
        return client.send(request.build(), handler);
    }

    private String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
