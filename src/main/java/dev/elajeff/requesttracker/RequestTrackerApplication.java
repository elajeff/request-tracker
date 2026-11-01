package dev.elajeff.requesttracker;

import java.util.Arrays;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class RequestTrackerApplication {

    public static void main(String[] args) {
        var application = new SpringApplication(RequestTrackerApplication.class);
        // Account commands run without starting the web server.
        if (Arrays.stream(args).anyMatch(argument -> argument.startsWith("--accounts.action="))) {
            application.setWebApplicationType(WebApplicationType.NONE);
        }
        application.run(args);
    }
}
