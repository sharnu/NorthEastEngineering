-- 015_ro_lifecycle.sql
-- Adds cancellation and reopen audit columns to repair_orders

ALTER TABLE repair_orders
  ADD COLUMN IF NOT EXISTS cancelled_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_by        UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reopened_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reopened_by         UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_ro_cancelled ON repair_orders (status, cancelled_at)
    WHERE status = 'CANCELLED';
