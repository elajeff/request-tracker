package dev.elajeff.requesttracker.security;

import java.io.IOException;

import jakarta.servlet.DispatcherType;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.SecurityContextHolderFilter;
import org.springframework.session.web.http.DefaultCookieSerializer;
import org.springframework.web.filter.OncePerRequestFilter;

@Configuration
public class SecurityConfiguration {
    @Bean
    PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder();
    }

    @Bean
    DefaultCookieSerializer cookieSerializer(@Value("${server.servlet.session.cookie.secure:true}") boolean secure) {
        var cookie = new DefaultCookieSerializer();
        cookie.setCookieName("RTSESSION");
        cookie.setCookiePath("/");
        cookie.setUseHttpOnlyCookie(true);
        cookie.setUseSecureCookie(secure);
        cookie.setSameSite("Lax");
        return cookie;
    }

    @Bean
    @ConditionalOnWebApplication
    SecurityFilterChain securityFilterChain(HttpSecurity http, AccountRepository accounts) throws Exception {
        // All role checks live here; services only apply ownership and business rules.
        http.authorizeHttpRequests(authorize -> authorize
                .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                .requestMatchers(HttpMethod.GET,
                        "/actuator/health", "/actuator/health/liveness", "/actuator/health/readiness",
                        "/actuator/prometheus", "/api/session").permitAll()
                .requestMatchers(HttpMethod.POST, "/api/session/login").permitAll()
                .requestMatchers("/api/staff/**").hasRole("SUPPORT")
                .requestMatchers(HttpMethod.PATCH, "/api/requests/**").hasRole("SUPPORT")
                .requestMatchers("/api/requests/**", "/api/session/logout").authenticated()
                .anyRequest().denyAll())
                .formLogin(form -> form.loginPage("/").loginProcessingUrl("/api/session/login")
                        .successHandler((request, response, authentication) -> response.setStatus(204))
                        .failureHandler((request, response, error) -> jsonError(response, 401, "Invalid username or password")))
                .logout(logout -> logout.logoutUrl("/api/session/logout").deleteCookies("RTSESSION")
                        .logoutSuccessHandler((request, response, authentication) -> response.setStatus(204)))
                .requestCache(cache -> cache.disable())
                .exceptionHandling(errors -> errors
                        .authenticationEntryPoint((request, response, error) -> jsonError(response, 401, "Sign in required"))
                        .accessDeniedHandler((request, response, error) -> jsonError(response, 403, "Access denied or invalid CSRF token")))
                .addFilterAfter(new EnabledAccountFilter(accounts), SecurityContextHolderFilter.class);
        return http.build();
    }

    // Same shape as Spring's problem details, so clients read every error the same way.
    private static void jsonError(HttpServletResponse response, int status, String detail) throws IOException {
        response.setStatus(status);
        response.setContentType("application/problem+json");
        response.getWriter().write("{\"status\":%d,\"title\":\"%s\",\"detail\":\"%s\"}"
                .formatted(status, HttpStatus.valueOf(status).getReasonPhrase(), detail));
    }

    // Check the database on each API call so disabling an account invalidates sessions across replicas.
    private static class EnabledAccountFilter extends OncePerRequestFilter {
        private final AccountRepository accounts;

        EnabledAccountFilter(AccountRepository accounts) {
            this.accounts = accounts;
        }

        @Override
        protected boolean shouldNotFilter(HttpServletRequest request) {
            return !request.getServletPath().startsWith("/api/");
        }

        @Override
        protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
                throws ServletException, IOException {
            var authentication = SecurityContextHolder.getContext().getAuthentication();
            if (authentication != null && authentication.isAuthenticated()
                    && accounts.find(authentication.getName()).filter(Account::enabled).isEmpty()) {
                var session = request.getSession(false);
                if (session != null) session.invalidate();
                SecurityContextHolder.clearContext();
                jsonError(response, 401, "Sign in required");
                return;
            }
            chain.doFilter(request, response);
        }
    }
}
