-- E10-S1: Scheduling schema — chassis inventory, customer approvals, RO extensions

-- Extend repair_orders
ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS drafting_status TEXT NOT NULL DEFAULT 'NOT_STARTED';
ALTER TABLE repair_orders ADD CONSTRAINT chk_ro_drafting_status
    CHECK (drafting_status IN ('NOT_STARTED','IN_PROGRESS','COMPLETED'));
ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS scheduled_start_week DATE;

-- Chassis inventory
CREATE TABLE chassis_inventory (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chassis_number   TEXT NOT NULL UNIQUE,
    description      TEXT NOT NULL,
    chassis_class    TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'AVAILABLE',
    allocated_to_ro  UUID REFERENCES repair_orders(id),
    received_at      TIMESTAMPTZ,
    allocated_at     TIMESTAMPTZ,
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_chassis_status CHECK (status IN ('AVAILABLE','ALLOCATED','DELIVERED'))
);

-- Customer approvals
CREATE TABLE customer_approvals (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ro_id            UUID NOT NULL REFERENCES repair_orders(id),
    document_type    TEXT NOT NULL,
    signed_at        TIMESTAMPTZ,
    signed_by_name   TEXT,
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_approval_doc_type CHECK (document_type IN ('LAYOUT','SPEC','COMPLIANCE'))
);

-- Seed chassis
INSERT INTO chassis_inventory (chassis_number, description, chassis_class, status) VALUES
    ('CN-001', 'Isuzu NPR 75-190 FRR', 'N', 'AVAILABLE'),
    ('CF-002', 'Isuzu FRR 90-210',     'F', 'AVAILABLE'),
    ('CF-003', 'Isuzu FRR 90-210',     'F', 'AVAILABLE');
