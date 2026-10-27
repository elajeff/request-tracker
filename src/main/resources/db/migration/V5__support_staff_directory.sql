CREATE TABLE support_staff (
    id UUID PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE service_requests ADD COLUMN assignee_id UUID REFERENCES support_staff(id);

-- A legacy label is not proof of identity: keep one inactive record per assigned request.
INSERT INTO support_staff (id, name, active)
SELECT id, assignee, FALSE FROM service_requests WHERE assignee IS NOT NULL;
UPDATE service_requests SET assignee_id = id WHERE assignee IS NOT NULL;
ALTER TABLE service_requests DROP COLUMN assignee;

CREATE INDEX service_requests_assignee_queue_idx
    ON service_requests (assignee_id, created_at DESC, id DESC);
