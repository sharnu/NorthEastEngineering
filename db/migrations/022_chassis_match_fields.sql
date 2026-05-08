ALTER TABLE chassis_inventory
    ADD COLUMN IF NOT EXISTS body_type    TEXT NULL,
    ADD COLUMN IF NOT EXISTS colour       TEXT NULL,
    ADD COLUMN IF NOT EXISTS tag_number   TEXT NULL,
    ADD COLUMN IF NOT EXISTS arrival_date DATE NULL,
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ NULL;

ALTER TABLE repair_orders
    ADD COLUMN IF NOT EXISTS chassis_tag TEXT NULL,
    ADD COLUMN IF NOT EXISTS colour      TEXT NULL;

CREATE INDEX IF NOT EXISTS ix_chassis_inventory_match ON chassis_inventory(body_type, status, arrival_date) WHERE status = 'AVAILABLE';
CREATE INDEX IF NOT EXISTS ix_chassis_inventory_tag   ON chassis_inventory(tag_number) WHERE tag_number IS NOT NULL;

-- Backfill body_type from chassis_class (N class = tipper, F class = tautliner)
UPDATE chassis_inventory
SET body_type = CASE chassis_class
    WHEN 'N' THEN 'TIPPER_CS'
    WHEN 'F' THEN 'TAUTLINER'
    ELSE NULL
END
WHERE body_type IS NULL;
