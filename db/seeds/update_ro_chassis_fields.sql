-- Patch seed ROs with colour and chassis_tag so E28 chassis suggestions score correctly.
-- RO00001 (rego XV70PX) → RO 58276 TIPPER_CS, White, tag T-276
-- RO00002 (rego C03672) → RO 58734 TAUTLINER, Arc White, tag 64F
UPDATE repair_orders SET colour = 'White',     chassis_tag = 'T-276' WHERE rego = 'XV70PX';
UPDATE repair_orders SET colour = 'Arc White', chassis_tag = '64F'   WHERE rego = 'C03672';

-- Insert demo chassis that match the seed ROs above.
-- Skip if already present (e.g. after a stock upload).
INSERT INTO chassis_inventory
    (id, chassis_number, description, chassis_class, status, body_type, colour, tag_number, arrival_date, created_at, updated_at)
VALUES
    -- Exact tag + colour match for RO00001 (TIPPER_CS, White, T-276)
    ('aaaaaaaa-0001-0001-0001-000000000001',
     'JALFVR34H67000006', 'Hino 500 TIPPER_CS',
     'N', 'AVAILABLE', 'TIPPER_CS', 'White', 'T-276', '2025-12-10',
     NOW(), NOW()),

    -- Colour-only match for RO00001 (score 50)
    ('aaaaaaaa-0001-0002-0002-000000000002',
     'LZZ8EXXC7SC707465', 'Foton TIPPER_CS',
     'N', 'AVAILABLE', 'TIPPER_CS', 'White', '83G', '2025-10-01',
     NOW(), NOW()),

    -- Exact tag + colour match for RO00002 (TAUTLINER, Arc White, 64F)
    ('aaaaaaaa-0002-0001-0001-000000000003',
     'JALFRR90NN7004213', 'Hino 500 TAUTLINER',
     'N', 'AVAILABLE', 'TAUTLINER', 'Arc White', '64F', '2026-03-15',
     NOW(), NOW()),

    -- No-match chassis (null body type, scores 0 — tests Available fallback)
    ('aaaaaaaa-0003-0001-0001-000000000004',
     'JALFXZ77VS7000077', 'Hino chassis mod',
     'N', 'AVAILABLE', NULL, NULL, NULL, '2026-01-20',
     NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
