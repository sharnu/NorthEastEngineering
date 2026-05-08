CREATE TABLE IF NOT EXISTS chassis_stock_uploads (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uploaded_by       UUID NOT NULL REFERENCES users(id),
    uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    file_name         TEXT NOT NULL,
    blob_path         TEXT NOT NULL,
    row_count         INT NOT NULL DEFAULT 0,
    inserted_count    INT NOT NULL DEFAULT 0,
    updated_count     INT NOT NULL DEFAULT 0,
    stale_after_count INT NOT NULL DEFAULT 0,
    status            TEXT NOT NULL DEFAULT 'PARSED'
                      CHECK (status IN ('PARSED','COMMITTED','REJECTED')),
    parse_errors      JSONB NULL,
    committed_at      TIMESTAMPTZ NULL
);
ALTER TABLE chassis_inventory ADD COLUMN IF NOT EXISTS source_upload_id UUID NULL REFERENCES chassis_stock_uploads(id);
