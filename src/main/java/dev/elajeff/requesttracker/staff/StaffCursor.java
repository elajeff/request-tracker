package dev.elajeff.requesttracker.staff;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Position in the staff list, ordered by (lower(name), id). Encoded as base64 "name,id". */
record StaffCursor(String name, UUID id) {
    static StaffCursor after(SupportStaff person) {
        return new StaffCursor(person.name(), person.id());
    }

    static StaffCursor decode(String value) {
        try {
            String text = new String(Base64.getUrlDecoder().decode(value), StandardCharsets.UTF_8);
            // A name can contain commas, an ID cannot.
            int split = text.lastIndexOf(',');
            if (split < 0) throw new IllegalArgumentException();
            String name = text.substring(0, split);
            UUID id = UUID.fromString(text.substring(split + 1));
            // PostgreSQL text cannot hold a NUL character.
            if (name.indexOf('\0') >= 0 || !id.toString().equals(text.substring(split + 1))) {
                throw new IllegalArgumentException();
            }
            return new StaffCursor(name, id);
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid staff cursor");
        }
    }

    String encode() {
        return Base64.getUrlEncoder().withoutPadding()
                .encodeToString((name + "," + id).getBytes(StandardCharsets.UTF_8));
    }
}
