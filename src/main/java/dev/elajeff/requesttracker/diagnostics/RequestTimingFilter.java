package dev.elajeff.requesttracker.diagnostics;

import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Tags every API response with the request ID nginx sent (or a new one) and logs requests slower
 * than {@code diagnostics.slow-request-millis}. The ID matches the nginx access log, so a slow
 * request can be followed from the proxy to the backend.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestTimingFilter extends OncePerRequestFilter {
    private static final Logger log = LoggerFactory.getLogger(RequestTimingFilter.class);
    private static final Pattern REQUEST_ID = Pattern.compile("[A-Za-z0-9-]{1,64}");

    private final long thresholdNanos;

    public RequestTimingFilter(@Value("${diagnostics.slow-request-millis:0}") long thresholdMillis) {
        this.thresholdNanos = thresholdMillis * 1_000_000;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/api/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String header = request.getHeader("X-Request-ID");
        String id = header != null && REQUEST_ID.matcher(header).matches() ? header : UUID.randomUUID().toString();
        response.setHeader("X-Request-ID", id);
        long started = System.nanoTime();
        try {
            chain.doFilter(request, response);
        } finally {
            long elapsed = System.nanoTime() - started;
            if (thresholdNanos > 0 && elapsed >= thresholdNanos) {
                log.warn("Slow request requestId={} method={} path={} status={} durationMs={}",
                        id, request.getMethod(), request.getRequestURI(), response.getStatus(), elapsed / 1_000_000);
            }
        }
    }
}
