package dev.elajeff.requesttracker.delivery;

import java.io.IOException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

// Compiled only by delivery/fault/Dockerfile, never by the normal application image.
@Component
public class InjectedFailureFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {
        if (request.getRequestURI().startsWith("/api/")) {
            response.setStatus(500);
            response.setContentType("application/json");
            response.getWriter().write("{\"error\":\"deliberate delivery exercise failure\"}");
            return;
        }
        chain.doFilter(request, response);
    }
}
