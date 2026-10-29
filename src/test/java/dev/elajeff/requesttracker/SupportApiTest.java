package dev.elajeff.requesttracker;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import dev.elajeff.requesttracker.security.AccountAdministration;
import tools.jackson.databind.json.JsonMapper;

import static org.junit.jupiter.api.Assertions.assertEquals;

abstract class SupportApiTest {
    @Value("${local.server.port}") private int apiPort;
    @Autowired private JsonMapper apiJson;
    @Autowired private AccountAdministration administration;
    protected ApiSession CLIENT;

    @BeforeEach
    void supportSession() throws Exception {
        String username = "support-" + UUID.randomUUID();
        String password = UUID.randomUUID().toString();
        administration.create(username, "SUPPORT", password);
        CLIENT = new ApiSession(apiPort, apiJson);
        assertEquals(204, CLIENT.login(username, password).statusCode());
        SecurityContextHolder.getContext().setAuthentication(UsernamePasswordAuthenticationToken.authenticated(
                username, null, List.of(new SimpleGrantedAuthority("ROLE_SUPPORT"))));
    }

    @AfterEach
    void clearAuthentication() {
        SecurityContextHolder.clearContext();
    }
}
