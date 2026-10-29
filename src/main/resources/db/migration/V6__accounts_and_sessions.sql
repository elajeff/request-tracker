CREATE TABLE login_accounts (
    id UUID PRIMARY KEY,
    username VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('REQUESTER', 'SUPPORT')),
    enabled BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE service_requests ADD COLUMN owner_id UUID REFERENCES login_accounts(id);
CREATE INDEX service_requests_owner_queue_idx ON service_requests (owner_id, created_at DESC, id DESC);
ALTER TABLE request_history ADD COLUMN actor_account_id UUID REFERENCES login_accounts(id);
ALTER TABLE request_history ADD COLUMN actor_username VARCHAR(64);
ALTER TABLE request_history DROP CONSTRAINT request_history_field_check;
ALTER TABLE request_history ADD CONSTRAINT request_history_field_check
    CHECK (field IN ('CREATED', 'TITLE', 'DESCRIPTION', 'STATUS', 'PRIORITY', 'ASSIGNEE', 'OWNER'));

-- Existing requests and events remain unattributed; staff records are not login identities.
CREATE TABLE spring_session (
    primary_id CHAR(36) NOT NULL PRIMARY KEY,
    session_id CHAR(36) NOT NULL,
    creation_time BIGINT NOT NULL,
    last_access_time BIGINT NOT NULL,
    max_inactive_interval INT NOT NULL,
    expiry_time BIGINT NOT NULL,
    principal_name VARCHAR(100)
);
CREATE UNIQUE INDEX spring_session_ix1 ON spring_session (session_id);
CREATE INDEX spring_session_ix2 ON spring_session (expiry_time);
CREATE INDEX spring_session_ix3 ON spring_session (principal_name);
CREATE TABLE spring_session_attributes (
    session_primary_id CHAR(36) NOT NULL REFERENCES spring_session(primary_id) ON DELETE CASCADE,
    attribute_name VARCHAR(200) NOT NULL,
    attribute_bytes BYTEA NOT NULL,
    PRIMARY KEY (session_primary_id, attribute_name)
);
