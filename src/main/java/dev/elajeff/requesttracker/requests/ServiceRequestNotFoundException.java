package dev.elajeff.requesttracker.requests;

import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

@ResponseStatus(HttpStatus.NOT_FOUND)
public class ServiceRequestNotFoundException extends RuntimeException {

    public ServiceRequestNotFoundException(UUID id) {
        super("Service request " + id + " was not found");
    }
}
