-- E12: Drafter artefact tracking
-- Extends repair_orders with drafted_by / drafted_at fields.
-- Drops and re-adds the drafting_status CHECK to include ON_HOLD.
-- No changes to the attachments table: DRAFT_LAYOUT, DRAFT_BOM,
-- DRAFT_DRAWING_PACK are new category values (unconstrained VARCHAR).

ALTER TABLE repair_orders
    ADD COLUMN IF NOT EXISTS drafted_by  UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS drafted_at  TIMESTAMPTZ;

-- Widen the drafting_status constraint to include ON_HOLD
ALTER TABLE repair_orders DROP CONSTRAINT IF EXISTS chk_ro_drafting_status;
ALTER TABLE repair_orders ADD CONSTRAINT chk_ro_drafting_status
    CHECK (drafting_status IN ('NOT_STARTED','IN_PROGRESS','COMPLETED','ON_HOLD'));
