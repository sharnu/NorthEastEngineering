-- Migration 017: flow-aware schema foundation
-- Adds flow_track to job_tasks, body_type to repair_orders,
-- is_merge_point to kanban_stages, and the flow_definitions table.
-- Idempotent: uses ADD COLUMN IF NOT EXISTS and CREATE TABLE IF NOT EXISTS.

-- 1. job_tasks: which production track each task belongs to
ALTER TABLE job_tasks
    ADD COLUMN IF NOT EXISTS flow_track TEXT NOT NULL DEFAULT 'BODY'
        CHECK (flow_track IN ('BODY','CHASSIS','SUBFRAME','ANY'));

-- 2. repair_orders: which body type drives the flow (nullable until backfill in 019)
ALTER TABLE repair_orders
    ADD COLUMN IF NOT EXISTS body_type TEXT NULL;

-- 3. kanban_stages: mark convergence points where all tracks must complete
ALTER TABLE kanban_stages
    ADD COLUMN IF NOT EXISTS is_merge_point BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE kanban_stages SET is_merge_point = TRUE WHERE id IN (70, 90);

-- 4. flow_definitions: data-driven ordered station sequences per (body_type, track)
CREATE TABLE IF NOT EXISTS flow_definitions (
    id          SERIAL PRIMARY KEY,
    body_type   TEXT NOT NULL,
    track       TEXT NOT NULL CHECK (track IN ('BODY','CHASSIS','SUBFRAME')),
    station_id  SMALLINT NOT NULL REFERENCES stations(id),
    sort_order  SMALLINT NOT NULL,
    is_optional BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (body_type, track, sort_order),
    UNIQUE (body_type, track, station_id)
);

CREATE INDEX IF NOT EXISTS ix_flow_definitions_body_type ON flow_definitions(body_type);

-- 5. Compound index to keep the grouped kanban query cheap
CREATE INDEX IF NOT EXISTS ix_job_tasks_ro_id_station_id ON job_tasks(ro_id, station_id);
