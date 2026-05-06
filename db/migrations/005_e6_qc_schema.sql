-- E6: QC + Email schema additions

-- Delivery-list email per customer (used as default recipient on QC completion email)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_dl TEXT;

UPDATE customers SET email_dl = 'fleet@bgt.com.au'           WHERE code = 'BGT';
UPDATE customers SET email_dl = 'fleet@directfreight.com.au' WHERE code = 'DFE';
UPDATE customers SET email_dl = 'fleet@ial.com.au'           WHERE code = 'IAL';

-- One QC submission per RO, created when the tech presses "Pass & send"
CREATE TABLE IF NOT EXISTS qc_submissions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    ro_id           UUID        NOT NULL UNIQUE REFERENCES repair_orders(id),
    task_id         UUID        NOT NULL REFERENCES job_tasks(id),
    submitted_by    UUID        NOT NULL REFERENCES users(id),
    submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    item_responses  JSONB       NOT NULL,   -- [{itemCode, label, checked}]
    notes           TEXT,
    email_sent      BOOLEAN     NOT NULL DEFAULT FALSE,
    email_sent_at   TIMESTAMPTZ,
    email_to        TEXT
);
