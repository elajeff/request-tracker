CREATE TABLE request_comments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    request_id UUID NOT NULL REFERENCES service_requests(id),
    author_account_id UUID NOT NULL REFERENCES login_accounts(id),
    author_username VARCHAR(64) NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX request_comments_request_id_id_idx ON request_comments (request_id, id DESC);
