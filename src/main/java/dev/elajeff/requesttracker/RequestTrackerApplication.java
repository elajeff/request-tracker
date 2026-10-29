package dev.elajeff.requesttracker;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class RequestTrackerApplication {

    public static void main(String[] args) {
        var application = new SpringApplication(RequestTrackerApplication.class);
        if (java.util.Arrays.stream(args).anyMatch(argument -> argument.startsWith("--accounts.action="))) {
            application.setWebApplicationType(org.springframework.boot.WebApplicationType.NONE);
        }
        application.run(args);
    }
}
