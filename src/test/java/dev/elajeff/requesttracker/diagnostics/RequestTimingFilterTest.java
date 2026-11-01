package dev.elajeff.requesttracker.diagnostics;

import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RequestTimingFilterTest {
    private final Logger logger = (Logger) LoggerFactory.getLogger(RequestTimingFilter.class);
    private final ListAppender<ILoggingEvent> logs = new ListAppender<>();

    @BeforeEach
    void captureLogs() {
        logs.start();
        logger.addAppender(logs);
    }

    @AfterEach
    void releaseLogs() {
        logger.detachAppender(logs);
    }

    @Test
    void keepsAValidRequestIdAndLogsSlowRequests() throws Exception {
        var request = new MockHttpServletRequest("GET", "/api/requests");
        request.addHeader("X-Request-ID", "run-42");
        var response = new MockHttpServletResponse();

        new RequestTimingFilter(1).doFilter(request, response, new MockFilterChain(sleepingServlet(20)));

        assertEquals("run-42", response.getHeader("X-Request-ID"));
        assertEquals(1, logs.list.size());
        assertTrue(logs.list.getFirst().getFormattedMessage().contains("requestId=run-42 method=GET path=/api/requests"));
    }

    @Test
    void replacesAnInvalidRequestIdAndSkipsFastRequests() throws Exception {
        var request = new MockHttpServletRequest("GET", "/api/requests");
        request.addHeader("X-Request-ID", "bad id\nwith newline");
        var response = new MockHttpServletResponse();

        new RequestTimingFilter(10_000).doFilter(request, response, new MockFilterChain());

        assertNotEquals("bad id\nwith newline", response.getHeader("X-Request-ID"));
        assertEquals(36, response.getHeader("X-Request-ID").length());
        assertTrue(logs.list.isEmpty());
    }

    @Test
    void doesNothingWhenDisabledOrOutsideTheApi() throws Exception {
        var health = new MockHttpServletResponse();
        new RequestTimingFilter(1).doFilter(new MockHttpServletRequest("GET", "/actuator/health"), health,
                new MockFilterChain(sleepingServlet(5)));
        new RequestTimingFilter(0).doFilter(new MockHttpServletRequest("GET", "/api/requests"),
                new MockHttpServletResponse(), new MockFilterChain(sleepingServlet(5)));

        assertNull(health.getHeader("X-Request-ID"));
        assertTrue(logs.list.isEmpty());
    }

    private static HttpServlet sleepingServlet(long millis) {
        return new HttpServlet() {
            @Override
            protected void service(HttpServletRequest request,
                    HttpServletResponse response) {
                try {
                    Thread.sleep(millis);
                } catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                }
            }
        };
    }
}
