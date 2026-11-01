package dev.elajeff.requesttracker.requests;

import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

public class ServiceRequestNotFoundException extends ResponseStatusException {

    public ServiceRequestNotFoundException(UUID id) {
        super(HttpStatus.NOT_FOUND, "Service request " + id + " was not found");
    }
}
