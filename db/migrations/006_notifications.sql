CREATE TABLE notifications (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id),
    event_type  TEXT        NOT NULL,
    title       TEXT        NOT NULL,
    body        TEXT        NOT NULL,
    entity_type TEXT,
    entity_id   UUID,
    is_read     BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON notifications (user_id, is_read, created_at DESC);
