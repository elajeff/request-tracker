ALTER TABLE service_requests ADD COLUMN assignee VARCHAR(120);

CREATE TABLE request_history (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    request_id UUID NOT NULL REFERENCES service_requests(id),
    field VARCHAR(20) NOT NULL CHECK (field IN ('CREATED', 'TITLE', 'DESCRIPTION', 'STATUS', 'PRIORITY', 'ASSIGNEE')),
    old_value TEXT,
    new_value TEXT,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX request_history_request_id_id_idx ON request_history (request_id, id DESC);
