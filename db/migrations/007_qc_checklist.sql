-- E6 gap: relational per-item checklist model

CREATE TABLE IF NOT EXISTS qc_checklist_items (
    id         SMALLINT PRIMARY KEY,
    code       TEXT     NOT NULL UNIQUE,
    label      TEXT     NOT NULL,
    sort_order SMALLINT NOT NULL DEFAULT 0
);

INSERT INTO qc_checklist_items (id, code, label, sort_order) VALUES
  (1, 'DIMENSIONS_VERIFIED',   'Dimensions verified against drawing', 1),
  (2, 'WELD_QUALITY_CHECKED',  'Weld quality — all welds, seams and mounts inspected', 2),
  (3, 'PAINT_FINISH_ACCEPTED', 'Paint finish — colour match, gloss, coverage', 3),
  (4, 'ELECTRICAL_TESTED',     'Electrical systems tested (lights, hydraulics, ABS)', 4),
  (5, 'PLACARDS_FITTED',       'Compliance placards fitted and legible', 5),
  (6, 'PHOTOS_COMPLETE',       'Photo evidence complete and uploaded', 6)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS qc_results (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    ro_id       UUID        NOT NULL REFERENCES repair_orders(id),
    item_code   TEXT        NOT NULL REFERENCES qc_checklist_items(code),
    passed      BOOLEAN     NOT NULL DEFAULT FALSE,
    notes       TEXT,
    recorded_by UUID        NOT NULL REFERENCES users(id),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (ro_id, item_code)
);

CREATE INDEX IF NOT EXISTS ix_qc_results_ro_id ON qc_results (ro_id);
