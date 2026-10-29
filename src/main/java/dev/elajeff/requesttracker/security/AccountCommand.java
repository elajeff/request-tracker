package dev.elajeff.requesttracker.security;

import java.util.Arrays;
import java.util.UUID;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty("accounts.action")
public class AccountCommand implements ApplicationRunner {
    private final AccountAdministration administration;
    private final ConfigurableApplicationContext context;

    public AccountCommand(AccountAdministration administration, ConfigurableApplicationContext context) {
        this.administration = administration;
        this.context = context;
    }

    @Override
    public void run(ApplicationArguments args) {
        try {
            String username = option(args, "accounts.username");
            switch (option(args, "accounts.action")) {
                case "create" -> create(username, option(args, "accounts.role"));
                case "disable" -> administration.disable(username);
                case "claim-legacy" -> administration.claimLegacy(username, UUID.fromString(option(args, "accounts.request-id")));
                default -> throw new IllegalArgumentException("Unknown account action");
            }
            System.out.println("Account operation completed");
        } finally {
            context.close();
        }
    }

    private void create(String username, String role) {
        String configured = System.getenv("REQUEST_TRACKER_ACCOUNT_PASSWORD");
        if (configured != null) {
            administration.create(username, role, configured);
            return;
        }
        var console = System.console();
        if (console == null) throw new IllegalArgumentException("Use a console with hidden input or REQUEST_TRACKER_ACCOUNT_PASSWORD");
        char[] password = console.readPassword("Initial password: ");
        if (password == null) throw new IllegalArgumentException("Password input cancelled");
        try {
            administration.create(username, role, new String(password));
        } finally {
            Arrays.fill(password, '\0');
        }
    }

    private static String option(ApplicationArguments args, String name) {
        var values = args.getOptionValues(name);
        if (values == null || values.size() != 1) throw new IllegalArgumentException("One --" + name + " value required");
        return values.getFirst();
    }
}
