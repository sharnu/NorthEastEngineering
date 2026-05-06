-- Migration 009: extended fields on repair_orders for PDF extraction
ALTER TABLE repair_orders
  ADD COLUMN IF NOT EXISTS source_ro_number  VARCHAR(20),
  ADD COLUMN IF NOT EXISTS source_ro_date    DATE,
  ADD COLUMN IF NOT EXISTS customer_no       VARCHAR(20),
  ADD COLUMN IF NOT EXISTS customer_abn      VARCHAR(20),
  ADD COLUMN IF NOT EXISTS owner_name        VARCHAR(200),
  ADD COLUMN IF NOT EXISTS customer_order_no VARCHAR(50),
  ADD COLUMN IF NOT EXISTS build_date        DATE,
  ADD COLUMN IF NOT EXISTS key_tag_no        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS odometer          INTEGER,
  ADD COLUMN IF NOT EXISTS contact_email     CITEXT,
  ADD COLUMN IF NOT EXISTS contact_phone     VARCHAR(40);
