CREATE INDEX service_requests_queue_order_idx ON service_requests (created_at DESC, id DESC);
