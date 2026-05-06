-- =====================================================================
-- NEE JOB CARD AND PRODUCTION LINE APPLICATION
-- Initial schema, PostgreSQL 15+
-- Migration 001
--
-- Convention: lowercase snake_case, plural tables, *_id foreign keys,
-- created_at and updated_at on every mutable table, soft delete via
-- is_active where appropriate. UUIDs for all surrogate keys except
-- short business codes that already have meaning (RO numbers, template
-- codes, station codes).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";      -- case-insensitive emails

-- ---------------------------------------------------------------------
-- AUDIT HELPER: trigger to keep updated_at fresh on every row update
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- =====================================================================
-- SECTION 1. IDENTITY AND ACCESS
-- In-app identity per the architectural decision. Roles are application
-- level; ASP.NET Core Identity tables are NOT used because we want full
-- control over the technician/station-owner/supervisor model.
-- =====================================================================

CREATE TABLE roles (
    id              SMALLINT PRIMARY KEY,
    code            VARCHAR(30) NOT NULL UNIQUE,
    name            VARCHAR(60) NOT NULL,
    description     TEXT
);

INSERT INTO roles (id, code, name, description) VALUES
    (1, 'ADMIN',          'Administrator',     'Full system access, master data management'),
    (2, 'SALES',           'Sales',            'Create RO, pick template, customer comms'),
    (3, 'DRAFTER',         'Drafter',          'Drawings, BOM, cutting list, template tweaks per RO'),
    (4, 'SUPERVISOR',      'Production supervisor', 'Schedule, prioritise, overall oversight'),
    (5, 'STATION_OWNER',   'Station owner',    'Team lead for a station, accepts and assigns tasks'),
    (6, 'TECHNICIAN',      'Technician',       'Executes tasks on the floor'),
    (7, 'QC',              'Quality control',  'Final QC, blue plate, NCR'),
    (8, 'VIEWER',          'Viewer',           'Read-only dashboards');

CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username            VARCHAR(60) NOT NULL UNIQUE,
    email               CITEXT UNIQUE,
    full_name           VARCHAR(120) NOT NULL,
    short_code          VARCHAR(10),                          -- e.g. 'Pr' for Peter Rogers
    password_hash       VARCHAR(255) NOT NULL,                -- ASP.NET Core PasswordHasher format
    password_changed_at TIMESTAMPTZ,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at       TIMESTAMPTZ,
    failed_login_count  SMALLINT NOT NULL DEFAULT 0,
    locked_until        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_active     ON users (is_active) WHERE is_active = TRUE;
CREATE INDEX idx_users_short_code ON users (short_code) WHERE short_code IS NOT NULL;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A user can hold multiple roles (e.g. a station owner who also QCs)
CREATE TABLE user_roles (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id     SMALLINT NOT NULL REFERENCES roles(id),
    granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    granted_by  UUID REFERENCES users(id),
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      VARCHAR(255) NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    replaced_by     UUID REFERENCES refresh_tokens(id),
    device_info     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user    ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens (expires_at) WHERE revoked_at IS NULL;


-- =====================================================================
-- SECTION 2. CORE MASTER DATA
-- Pruned from the original master_tables.sql to what the application
-- actually needs. Body type drives the template taxonomy. Job type
-- distinguishes new build / repair / swap. Customer is now first-class
-- because templates can be customer-overridden.
-- =====================================================================

CREATE TABLE body_types (
    id              SMALLINT PRIMARY KEY,
    code            VARCHAR(10) NOT NULL UNIQUE,            -- TR, TP, TT, DP, CH, TS, VP
    name            VARCHAR(60) NOT NULL UNIQUE,
    description     TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order      SMALLINT NOT NULL DEFAULT 0
);

INSERT INTO body_types (id, code, name, description, sort_order) VALUES
    (1,  'TR', 'Tray',          'Flat tray body, with or without dropsides',                10),
    (2,  'TP', 'Tipper',        'Hydraulic tipper body',                                    20),
    (3,  'TT', 'Tautliner',     'Curtain-side tautliner body',                              30),
    (4,  'DP', 'Drop-side / Pantech', 'Enclosed pantech or drop-side van body',             40),
    (5,  'CH', 'Chipper',       'Chipper truck body with tool storage',                     50),
    (6,  'TS', 'Tilt slider',   'Tilt slider body with hydraulic deck',                     60),
    (7,  'VP', 'Vac pantech',   'Vacuum unit pantech body',                                 70),
    (8,  'BS', 'Body swap',     'Body swap onto existing chassis',                          80),
    (9,  'RP', 'Repair',        'Repair-only job, no new body',                             90),
    (10, 'AC', 'Accessories',   'Accessories fitment only',                                100),
    (11, 'CM', 'Chassis modification', 'Chassis-only work',                                110);

CREATE TABLE job_types (
    id              SMALLINT PRIMARY KEY,
    code            VARCHAR(20) NOT NULL UNIQUE,
    name            VARCHAR(60) NOT NULL,
    requires_chassis BOOLEAN NOT NULL DEFAULT TRUE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO job_types (id, code, name, requires_chassis) VALUES
    (1, 'NEW_BUILD',   'New build',           TRUE),
    (2, 'BODY_SWAP',   'Body swap',           TRUE),
    (3, 'REPAIR',      'Repair',              TRUE),
    (4, 'WARRANTY',    'Warranty',            TRUE),
    (5, 'ACCESSORIES', 'Accessories fitment', FALSE),
    (6, 'CHASSIS_MOD', 'Chassis modification', TRUE);

CREATE TABLE customers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            VARCHAR(20) UNIQUE,                     -- DFE, IAL, BGT, NULL for one-off
    name            VARCHAR(200) NOT NULL,
    abn             VARCHAR(20),
    customer_no     VARCHAR(20) UNIQUE,                     -- DMS customer number, e.g. '649'
    bill_to_name    VARCHAR(200),
    bill_to_address TEXT,
    contact_email   CITEXT,
    contact_phone   VARCHAR(40),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_customers_code   ON customers (code) WHERE code IS NOT NULL;
CREATE INDEX idx_customers_active ON customers (is_active) WHERE is_active = TRUE;
CREATE TRIGGER trg_customers_updated_at BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed the three named customer prefixes from the docx
INSERT INTO customers (code, name) VALUES
    ('DFE', 'Direct Freight Express'),
    ('IAL', 'IAL'),                   -- placeholder, update with full name
    ('BGT', 'BGT');                   -- placeholder, update with full name


-- =====================================================================
-- SECTION 3. STATIONS AND THE OPERATION CATALOG
-- Stations are physical/logical work areas. Each station has an owner
-- (team lead). The operation_catalog normalises the 60+ operation names
-- found across the 46 templates into a canonical list, each pointing at
-- the station that owns it. This is what makes routing automatic.
-- =====================================================================

CREATE TABLE stations (
    id                 SMALLINT PRIMARY KEY,
    code               VARCHAR(30) NOT NULL UNIQUE,
    name               VARCHAR(100) NOT NULL,
    description        TEXT,
    owner_user_id      UUID REFERENCES users(id),           -- the station owner / team lead
    reports_to_user_id UUID REFERENCES users(id),           -- supervisor
    sort_order         SMALLINT NOT NULL DEFAULT 0,
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stations_owner ON stations (owner_user_id);
CREATE TRIGGER trg_stations_updated_at BEFORE UPDATE ON stations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Stations derived from the operations process flow PDF. owner/reports
-- references intentionally NULL; populate after seeding users.
INSERT INTO stations (id, code, name, sort_order) VALUES
    (10, 'MATERIAL_PROC',    'Material processing / CNC',          10),
    (20, 'FAB_LINE',         'Fabrication line',                   20),
    (25, 'ROBOTIC_FAB',      'Robotic fabrication',                25),
    (30, 'PAINT_PANEL',      'Paint and panel',                    30),
    (40, 'BODY_FITOUT',      'Body fitout (B1)',                   40),
    (50, 'CHASSIS_PREP',     'Chassis prep (B3)',                  50),
    (60, 'HYVA',             'HYVA hydraulics',                    60),
    (70, 'FINAL_FITMENT',    'Final fitment (B2)',                 70),
    (80, 'PANTECH',          'Pantech assembly',                   80),
    (90, 'COMPLIANCE_QC',    'Vehicle compliance and final QC',    90),
    (95, 'HOSPITAL',         'Hospital zone',                      95);

-- Many technicians can be rostered to a station (their primary plus secondaries)
CREATE TABLE station_technicians (
    station_id      SMALLINT NOT NULL REFERENCES stations(id),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_primary      BOOLEAN NOT NULL DEFAULT FALSE,         -- TRUE for the station's home station
    skill_level     SMALLINT NOT NULL DEFAULT 3,            -- 1=trainee, 5=expert
    PRIMARY KEY (station_id, user_id)
);
CREATE INDEX idx_station_techs_user ON station_technicians (user_id);

-- The operation catalog: the master list of distinct operations performed
-- across all body types. Each operation defaults to a station for routing.
CREATE TABLE operation_catalog (
    id                  SMALLINT PRIMARY KEY,
    code                VARCHAR(40) NOT NULL UNIQUE,
    canonical_name      VARCHAR(120) NOT NULL,                  -- the one true name
    default_station_id  SMALLINT NOT NULL REFERENCES stations(id),
    typical_hours       NUMERIC(5,2),                            -- learnt from data, advisory
    description         TEXT,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_op_catalog_updated_at BEFORE UPDATE ON operation_catalog
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Aliases: the messy names found in the docx all collapse to one canonical
-- operation. e.g. 'PAINT PREP & RUB', 'PAINT PREP & RUBBING', and
-- 'TIPPER BODY PAINT PREP & RUBBING' all point to operation_id for
-- 'paint prep and rubbing'.
CREATE TABLE operation_aliases (
    id              SERIAL PRIMARY KEY,
    operation_id    SMALLINT NOT NULL REFERENCES operation_catalog(id),
    alias_text      VARCHAR(200) NOT NULL UNIQUE
);
CREATE INDEX idx_op_aliases_op ON operation_aliases (operation_id);

-- Seed the catalog with operations observed across the 46 templates
INSERT INTO operation_catalog (id, code, canonical_name, default_station_id, typical_hours) VALUES
    -- Material processing (1x)
    (10, 'MAT_PROC_CNC',     'Material processing / CNC',                10, 8.0),
    (11, 'MAT_PROC_FIBRE',   'Fibre gloss panel processing / CNC',       10, 8.5),
    -- Fabrication (20s)
    (20, 'MFR_BASE',         'Manufacture base',                         20, 4.5),
    (21, 'MFR_FRONT_WALL',   'Manufacture front wall',                   20, 4.0),
    (22, 'MFR_REAR_WALL',    'Manufacture rear wall',                    20, 4.0),
    (23, 'MFR_ROOF',         'Manufacture roof',                         20, 4.0),
    (24, 'MFR_HEADBOARD',    'Manufacture headboard',                    20, 2.5),
    (25, 'MFR_DROPSIDES',    'Manufacture dropsides and tailgate',       20, 5.0),
    (26, 'MFR_REAR_FRAME',   'Manufacture rear frame',                   20, 3.0),
    (27, 'MFR_REAR_DOORS',   'Manufacture rear doors',                   20, 3.0),
    (28, 'MFR_SUBFRAME',     'Manufacture subframe',                     20, 3.0),
    (29, 'MFR_TAILGATE',     'Manufacture tailgate',                     20, 3.0),
    (30, 'MFR_TOOLBOX',      'Manufacture toolbox or sign rack',         20, 7.5),
    (31, 'FAB_LINE_ASSY',    'Fabrication line assembly',                20, 6.0),
    (32, 'TRAY_ASSY',        'Tray assembly',                            20, 8.0),
    -- Body fitout / chassis prep
    (40, 'BODY_FITOUT',           'Body fitout',                         40, 4.0),
    (41, 'CHASSIS_PREP_FLITCH',   'Chassis prep, flitch and electrical', 50, 4.5),
    (42, 'SUBFRAME_PTO_HYD',      'Subframe PTO and hydraulics fitout',  60, 2.5),
    -- Paint (30s, all at PAINT_PANEL = 30)
    (50, 'PAINT_PREP_RUB',     'Paint prep and rubbing',                 30, 4.5),
    (51, 'PAINT_PRIME_SEAL',   'Prime, seal and rub',                    30, 4.5),
    (52, 'PAINT_FINAL',        'Final paint',                            30, 4.5),
    (53, 'PAINT_SUBFRAME',     'Paint subframe (rub, prime, seal, paint)', 30, 2.0),
    (54, 'PAINT_UNDERSIDE',    'Underside black and touch up',           30, 1.5),
    (55, 'PAINT_ROLL_FLOOR',   'Roll floor and touch up',                30, 0.5),
    -- Fitment and electrics
    (60, 'FITMENT_INSTALL',    'Fitment, install body and welddown',     70, 8.0),
    (61, 'WIRING_LIGHTS',      'Wiring of clearance and tail lights',    70, 0.5),
    (62, 'FIT_ACCESSORIES',    'Fit supplied accessories (bullbar, PDA)', 70, 1.0),
    -- QC
    (70, 'BLUE_PLATE_QC',      'Blue plate and final QC',                90, 1.0);

-- Seed the alias map so the docx import resolves correctly
INSERT INTO operation_aliases (operation_id, alias_text) VALUES
    (10, 'MATERIAL PROCESSING/CNC'),
    (10, 'MATERIAL PROCESSING/CNC (METAL)'),
    (11, 'FIBER GLOSS PANEL PROCESSING/CNC'),
    (20, 'MANUFACTURE BASE'),
    (21, 'MANUFACTURE FRONT WALL'),
    (22, 'MANUFACTURE REAR WALL'),
    (23, 'MANUFACTURE ROOF'),
    (24, 'MANUFACTURE HEADBOARD'),
    (25, 'MANUFACTURE 300MM DROPSIDES (4 QTY) + TAILGATE (1 QTY)'),
    (25, 'MANUFACTURE 350MM DROPSIDES (2 QTY) + TAILGATE (1 QTY)'),
    (25, 'MANUFACTURE 450MM DROPSIDES (2 QTY) + TAILGATE (1 QTY)'),
    (26, 'MANUFACTURE REAR FRAME'),
    (27, 'MANUFACTURE REAR DOORS'),
    (27, 'MANUFACTURE REAR BARN DOORS'),
    (28, 'MANUFACTURE SUBFRAME'),
    (30, 'MANUFACTURE P/SIDE CHIPPER TOOLBOX'),
    (31, 'FABRICATION LINE ASSEMBLY'),
    (32, 'TRAY ASSEMBLY OF HEADBOARD'),
    (32, 'TRAY ASSEMBLY OF HEADBOARD AND DROPSIDES'),
    (40, 'BODY FITOUT'),
    (41, 'CHASSIS PREP'),
    (41, 'CHASSIS PREP: FLITCH PLATES AND PLASTICS; ELECTRICAL PREP'),
    (42, 'SUBFRAME PTO & HYDRAULICS FITOUT'),
    (50, 'PAINT PREP & RUB'),
    (50, 'PAINT PREP & RUBBING'),
    (50, 'TIPPER BODY PAINT PREP & RUBBING'),
    (50, 'CHIPPER BODY AND TOOLBOX PAINT PREP & RUBBING'),
    (51, 'PRIME, SEAL & RUB'),
    (51, 'PRIME, BLACK AND SEAL'),
    (51, 'PRIME 2 PAC, AND SEAL'),
    (51, 'PRIME 2 PAC, SEAL & RUB'),
    (52, 'FINAL PAINT'),
    (53, 'PAINT SUBFRAME: RUB, PRIME, SEAL AND PAINT'),
    (54, 'UNDERSIDE BLACK AND TOUCH UP'),
    (55, 'ROLL FLOOR AND TOUCH UP'),
    (60, 'FITMENT: INSTALL BODY AND WELDDOWN, FIT MUD FLAPS'),
    (60, 'FITMENT: TIPPER INSTALL AND WELDDOWN, FIT MUD FLAPS'),
    (60, 'FITMENT: INSTALL BODY AND FIT TAILGATE'),
    (60, 'TRAY INSTALL AND WELD DOWN; FIT PRE-MADE MUD GUARDS'),
    (60, 'TRAY FITMENT'),
    (61, 'TIPPER WIRING OF CLEARANCE LIGHTS AND TAILLIGHTS'),
    (61, 'TRAY WIRING OF CLEARANCE LIGHTS AND TAIL LIGHTS'),
    (61, 'WIRING OF CLEARANCE LIGHTS AND TAILLIGHTS'),
    (70, 'BLUE PLATE AND FINAL QC');


-- =====================================================================
-- SECTION 4. JOB CODE TEMPLATE CATALOG
-- The 46 templates from Job_Card_Description.docx are first-class data.
-- A template has versions; the live RO instances point at a specific
-- version so old jobs aren't disturbed when an estimate is recalibrated.
-- =====================================================================

CREATE TABLE job_code_templates (
    code                VARCHAR(40) PRIMARY KEY,                -- e.g. 'TT67F', 'DFE-TT67F'
    base_code           VARCHAR(40),                            -- 'TT67F' for 'DFE-TT67F'; NULL if base
    customer_id         UUID REFERENCES customers(id),          -- non-null for customer variants
    body_type_id        SMALLINT NOT NULL REFERENCES body_types(id),
    job_type_id         SMALLINT NOT NULL REFERENCES job_types(id) DEFAULT 1,
    name                VARCHAR(200) NOT NULL,
    description         TEXT,
    body_size_mm        INTEGER,                                -- e.g. 6700 for TT67F
    chassis_class       CHAR(1),                                -- 'N' = NPR/medium, 'F' = FRR/heavy
    variant_suffix      VARCHAR(40),                            -- 'D', 'SD', 'T600', etc.
    current_version     INTEGER NOT NULL DEFAULT 1,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_chassis_class CHECK (chassis_class IS NULL OR chassis_class IN ('N','F')),
    CONSTRAINT fk_base_code FOREIGN KEY (base_code) REFERENCES job_code_templates(code)
);
CREATE INDEX idx_templates_body  ON job_code_templates (body_type_id);
CREATE INDEX idx_templates_cust  ON job_code_templates (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_templates_base  ON job_code_templates (base_code) WHERE base_code IS NOT NULL;
CREATE TRIGGER trg_templates_updated_at BEFORE UPDATE ON job_code_templates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Versioned snapshots of the operation list. When a supervisor recalibrates
-- estimated hours, a new version is created; the previous version stays
-- intact so historic ROs still reference the numbers they were quoted at.
CREATE TABLE template_versions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_code       VARCHAR(40) NOT NULL REFERENCES job_code_templates(code) ON DELETE CASCADE,
    version_number      INTEGER NOT NULL,
    effective_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
    superseded_at       TIMESTAMPTZ,
    total_estimated_hours NUMERIC(7,2) NOT NULL,
    approved_by         UUID REFERENCES users(id),
    approval_notes      TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (template_code, version_number)
);
CREATE INDEX idx_template_versions_active
    ON template_versions (template_code) WHERE superseded_at IS NULL;

-- Each operation in a template is one row. Sequence preserves ordering.
CREATE TABLE template_operations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_version_id UUID NOT NULL REFERENCES template_versions(id) ON DELETE CASCADE,
    sequence            SMALLINT NOT NULL,
    operation_id        SMALLINT NOT NULL REFERENCES operation_catalog(id),
    -- Per-template overrides; if NULL, falls back to operation_catalog defaults
    estimated_hours     NUMERIC(5,2) NOT NULL,
    station_id_override SMALLINT REFERENCES stations(id),
    notes               TEXT,
    UNIQUE (template_version_id, sequence)
);
CREATE INDEX idx_template_ops_version ON template_operations (template_version_id);
CREATE INDEX idx_template_ops_op      ON template_operations (operation_id);


-- =====================================================================
-- SECTION 5. REPAIR ORDERS AND TASK INSTANCES
-- An RO is the live job. When sales picks a template, the system
-- materialises template_operations into job_tasks. Each task tracks
-- estimated vs actual hours and routes to a station automatically.
-- =====================================================================

CREATE TABLE repair_orders (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ro_number           VARCHAR(20) NOT NULL UNIQUE,             -- e.g. '58734'
    customer_id         UUID NOT NULL REFERENCES customers(id),
    template_code       VARCHAR(40) NOT NULL REFERENCES job_code_templates(code),
    template_version_id UUID NOT NULL REFERENCES template_versions(id),
    job_type_id         SMALLINT NOT NULL REFERENCES job_types(id),

    -- Vehicle details from the RO PDF
    vin                 VARCHAR(30),
    rego               VARCHAR(20),
    chassis_number      VARCHAR(40),
    engine_number       VARCHAR(40),
    make                VARCHAR(40),
    model               VARCHAR(60),
    paint_colour        VARCHAR(60),

    -- Dates
    ro_date             DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_in_date    TIMESTAMPTZ,
    required_date       TIMESTAMPTZ,
    delivery_date       DATE,
    actual_completion_at TIMESTAMPTZ,

    -- State
    status              VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    delivery_block_reason VARCHAR(40),                            -- TBA, NO_CHASSIS, BOOK_IN, EXTERNAL_BB, NULL
    priority            SMALLINT NOT NULL DEFAULT 3,              -- 1=urgent, 5=low
    notes               TEXT,

    -- Audit
    created_by          UUID NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_ro_status CHECK (status IN
        ('DRAFT','QUOTED','APPROVED','IN_PROGRESS','ON_HOLD','COMPLETED','CANCELLED')),
    CONSTRAINT chk_ro_priority CHECK (priority BETWEEN 1 AND 5)
);
CREATE INDEX idx_ro_status        ON repair_orders (status);
CREATE INDEX idx_ro_customer      ON repair_orders (customer_id);
CREATE INDEX idx_ro_template      ON repair_orders (template_code);
CREATE INDEX idx_ro_required_date ON repair_orders (required_date) WHERE status NOT IN ('COMPLETED','CANCELLED');
CREATE TRIGGER trg_ro_updated_at BEFORE UPDATE ON repair_orders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Live task: one row per template_operation, instantiated for this RO.
CREATE TABLE job_tasks (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ro_id               UUID NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
    sequence            SMALLINT NOT NULL,
    job_code_line       VARCHAR(60) NOT NULL,                    -- e.g. '01DFE-TT67F-CNC'
    operation_id        SMALLINT NOT NULL REFERENCES operation_catalog(id),
    operation_name      VARCHAR(200) NOT NULL,                   -- snapshot at instantiation
    station_id          SMALLINT NOT NULL REFERENCES stations(id),
    assigned_to_user_id UUID REFERENCES users(id),               -- the technician
    assigned_by_user_id UUID REFERENCES users(id),               -- station owner who assigned
    assigned_at         TIMESTAMPTZ,

    estimated_hours     NUMERIC(5,2) NOT NULL,
    actual_hours        NUMERIC(7,2) NOT NULL DEFAULT 0,         -- summed from time_entries

    status              VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,

    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_task_status CHECK (status IN
        ('PENDING','ASSIGNED','IN_PROGRESS','PAUSED','COMPLETED','BLOCKED','CANCELLED')),
    UNIQUE (ro_id, sequence)
);
CREATE INDEX idx_tasks_ro       ON job_tasks (ro_id);
CREATE INDEX idx_tasks_station  ON job_tasks (station_id, status);
CREATE INDEX idx_tasks_assignee ON job_tasks (assigned_to_user_id, status)
    WHERE assigned_to_user_id IS NOT NULL;
CREATE INDEX idx_tasks_open     ON job_tasks (status) WHERE status NOT IN ('COMPLETED','CANCELLED');
CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON job_tasks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =====================================================================
-- SECTION 6. TIME ENTRIES AND VARIANCE
-- A technician clocks in and out against a task. Each clock-in/out pair
-- is one time_entry row. actual_hours on the task is the sum.
-- A variance_record is created when the task closes; it carries the
-- delta and a reason code so reporting can aggregate.
-- =====================================================================

CREATE TABLE time_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id         UUID NOT NULL REFERENCES job_tasks(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id),
    clock_in        TIMESTAMPTZ NOT NULL,
    clock_out       TIMESTAMPTZ,                                 -- NULL while still clocked in
    duration_minutes INTEGER GENERATED ALWAYS AS
        (CASE WHEN clock_out IS NULL THEN NULL
              ELSE EXTRACT(EPOCH FROM (clock_out - clock_in))::INT / 60
         END) STORED,
    activity_type   VARCHAR(20) NOT NULL DEFAULT 'WORK',         -- WORK, PAUSE, REWORK
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_clock_order CHECK (clock_out IS NULL OR clock_out > clock_in),
    CONSTRAINT chk_activity    CHECK (activity_type IN ('WORK','PAUSE','REWORK'))
);
CREATE INDEX idx_time_task         ON time_entries (task_id);
CREATE INDEX idx_time_user_open    ON time_entries (user_id) WHERE clock_out IS NULL;
CREATE INDEX idx_time_clock_in     ON time_entries (clock_in);

-- Reference list of variance reasons so reports can aggregate cleanly
CREATE TABLE variance_reasons (
    id              SMALLINT PRIMARY KEY,
    code            VARCHAR(30) NOT NULL UNIQUE,
    name            VARCHAR(80) NOT NULL,
    is_overrun      BOOLEAN NOT NULL DEFAULT TRUE,                -- distinguishes positive vs negative variance
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO variance_reasons (id, code, name, is_overrun) VALUES
    (1,  'MISSING_PARTS',     'Missing or delayed parts',           TRUE),
    (2,  'REWORK',            'Rework after QC fail',               TRUE),
    (3,  'SCOPE_CHANGE',      'Scope change by customer',           TRUE),
    (4,  'DRAWING_ISSUE',     'Drawing or BOM issue',               TRUE),
    (5,  'MACHINE_DOWN',      'Machine breakdown',                  TRUE),
    (6,  'TRAINING',          'Trainee on task, slower than baseline', TRUE),
    (7,  'HOSPITAL_ZONE',     'Sent to hospital zone',              TRUE),
    (8,  'SUPPLIER_NCR',      'Supplier non-conformance',           TRUE),
    (9,  'CUSTOMER_REVISION', 'Customer revision mid-build',        TRUE),
    (10, 'WEATHER',           'Weather affecting paint or outdoor work', TRUE),
    (11, 'AS_ESTIMATED',      'Completed within estimate',          FALSE),
    (12, 'AHEAD_OF_ESTIMATE', 'Completed faster than estimate',     FALSE),
    (13, 'OTHER',             'Other (see notes)',                  TRUE);

CREATE TABLE variance_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id         UUID NOT NULL UNIQUE REFERENCES job_tasks(id) ON DELETE CASCADE,
    estimated_hours NUMERIC(5,2) NOT NULL,
    actual_hours    NUMERIC(7,2) NOT NULL,
    delta_hours     NUMERIC(7,2) GENERATED ALWAYS AS (actual_hours - estimated_hours) STORED,
    delta_percent   NUMERIC(6,2) GENERATED ALWAYS AS
        (CASE WHEN estimated_hours = 0 THEN NULL
              ELSE ROUND(((actual_hours - estimated_hours) / estimated_hours * 100)::numeric, 2)
         END) STORED,
    reason_id       SMALLINT NOT NULL REFERENCES variance_reasons(id),
    notes           TEXT,
    recorded_by     UUID NOT NULL REFERENCES users(id),
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_variance_reason ON variance_records (reason_id);
CREATE INDEX idx_variance_recorded_at ON variance_records (recorded_at);


-- =====================================================================
-- SECTION 7. KANBAN AND DOMAIN EVENTS
-- A task progresses through kanban stages. Each stage transition emits
-- a domain event for projection into read models, dashboards, and
-- downstream integrations.
-- =====================================================================

CREATE TABLE kanban_stages (
    id              SMALLINT PRIMARY KEY,
    code            VARCHAR(30) NOT NULL UNIQUE,
    name            VARCHAR(80) NOT NULL,
    sort_order      SMALLINT NOT NULL,
    is_terminal     BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO kanban_stages (id, code, name, sort_order, is_terminal) VALUES
    (10, 'JOB_RECEIVED',    'Job received',         10, FALSE),
    (20, 'IN_DRAFTING',     'In drafting',          20, FALSE),
    (30, 'MAT_PROCESSING',  'Material processing',  30, FALSE),
    (40, 'FABRICATION',     'Fabrication',          40, FALSE),
    (50, 'PAINTING',        'Painting',             50, FALSE),
    (60, 'AFTER_PAINT_HY',  'After paint, HYVA',    60, FALSE),
    (70, 'FITOUT',          'Fitout',               70, FALSE),
    (80, 'BODY_MOUNTING',   'Body mounting',        80, FALSE),
    (85, 'ACCESSORIES',     'Accessories',          85, FALSE),
    (90, 'FINAL_QC',        'Final QC',             90, FALSE),
    (95, 'HOSPITAL',        'Hospital zone',        95, FALSE),
    (99, 'COMPLETE',        'Complete',             99, TRUE);

CREATE TABLE ro_kanban_state (
    ro_id               UUID PRIMARY KEY REFERENCES repair_orders(id) ON DELETE CASCADE,
    current_stage_id    SMALLINT NOT NULL REFERENCES kanban_stages(id),
    entered_stage_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_kanban_updated_at BEFORE UPDATE ON ro_kanban_state
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Append-only event log. Powers the activity feed, audit trail, and
-- downstream projections (read models, dashboards, exports).
CREATE TABLE domain_events (
    id              BIGSERIAL PRIMARY KEY,
    event_type      VARCHAR(60) NOT NULL,                       -- 'RoCreated', 'TaskAssigned', etc.
    aggregate_type  VARCHAR(40) NOT NULL,                       -- 'RepairOrder', 'JobTask'
    aggregate_id    UUID NOT NULL,
    payload         JSONB NOT NULL,
    user_id         UUID REFERENCES users(id),
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_aggregate ON domain_events (aggregate_type, aggregate_id, occurred_at);
CREATE INDEX idx_events_type      ON domain_events (event_type, occurred_at);
CREATE INDEX idx_events_payload   ON domain_events USING GIN (payload);


-- =====================================================================
-- SECTION 8. DOCUMENT ATTACHMENTS
-- Drawing packs, BOMs, cutting lists, QC photos. Files live in Azure
-- Blob Storage; this table holds metadata and the blob reference.
-- =====================================================================

CREATE TABLE attachments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type     VARCHAR(40) NOT NULL,                       -- 'RepairOrder', 'JobTask', 'Template'
    entity_id       UUID NOT NULL,
    category        VARCHAR(30) NOT NULL,                       -- DRAWING, BOM, CUTTING_LIST, PHOTO, QC, OTHER
    file_name       VARCHAR(255) NOT NULL,
    content_type    VARCHAR(120) NOT NULL,
    size_bytes      BIGINT NOT NULL,
    blob_container  VARCHAR(60) NOT NULL,
    blob_path       VARCHAR(500) NOT NULL,
    uploaded_by     UUID NOT NULL REFERENCES users(id),
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_attachments_entity ON attachments (entity_type, entity_id);
CREATE INDEX idx_attachments_cat    ON attachments (category);


-- =====================================================================
-- SECTION 9. READ MODELS (MATERIALIZED VIEWS) FOR DASHBOARDS
-- The Power BI Towbar Station view replicated as queryable views.
-- Refresh on a schedule or via domain event triggers.
-- =====================================================================

-- Per-RO summary: hours scheduled vs utilised, completion %, current stage
CREATE VIEW v_ro_summary AS
SELECT
    ro.id                                AS ro_id,
    ro.ro_number,
    ro.template_code,
    ro.status,
    ro.priority,
    ro.required_date,
    c.name                               AS customer_name,
    bt.name                              AS body_type,
    ks.name                              AS current_stage,
    COUNT(t.id)                          AS task_count,
    COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED')         AS tasks_completed,
    SUM(t.estimated_hours)               AS hours_scheduled,
    SUM(t.actual_hours)                  AS hours_utilised,
    SUM(t.actual_hours) - SUM(t.estimated_hours)              AS variance_hours,
    CASE WHEN SUM(t.estimated_hours) = 0 THEN NULL
         ELSE ROUND((SUM(t.actual_hours) / SUM(t.estimated_hours) * 100)::numeric, 1)
    END                                  AS utilisation_pct
FROM repair_orders ro
JOIN customers       c  ON c.id = ro.customer_id
JOIN job_code_templates jt ON jt.code = ro.template_code
JOIN body_types      bt ON bt.id = jt.body_type_id
LEFT JOIN ro_kanban_state rks ON rks.ro_id = ro.id
LEFT JOIN kanban_stages ks ON ks.id = rks.current_stage_id
LEFT JOIN job_tasks  t  ON t.ro_id = ro.id
GROUP BY ro.id, ro.ro_number, ro.template_code, ro.status, ro.priority,
         ro.required_date, c.name, bt.name, ks.name;

-- Per-station load: open tasks, hours pending, slowest current task
CREATE VIEW v_station_load AS
SELECT
    s.id                                 AS station_id,
    s.code                               AS station_code,
    s.name                               AS station_name,
    u.full_name                          AS owner_name,
    COUNT(t.id) FILTER (WHERE t.status IN ('PENDING','ASSIGNED','IN_PROGRESS','PAUSED','BLOCKED')) AS open_tasks,
    COUNT(t.id) FILTER (WHERE t.status = 'IN_PROGRESS')       AS active_tasks,
    SUM(t.estimated_hours - t.actual_hours)
        FILTER (WHERE t.status NOT IN ('COMPLETED','CANCELLED'))    AS hours_remaining,
    SUM(t.estimated_hours) FILTER (WHERE t.status = 'COMPLETED')    AS hours_scheduled_done,
    SUM(t.actual_hours)    FILTER (WHERE t.status = 'COMPLETED')    AS hours_utilised_done
FROM stations s
LEFT JOIN users u ON u.id = s.owner_user_id
LEFT JOIN job_tasks t ON t.station_id = s.id
WHERE s.is_active = TRUE
GROUP BY s.id, s.code, s.name, u.full_name, s.sort_order
ORDER BY s.sort_order;

-- Per-technician productivity: tasks completed, avg variance, current load
CREATE VIEW v_technician_performance AS
SELECT
    u.id                                 AS user_id,
    u.full_name,
    u.short_code,
    COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED' AND t.completed_at >= now() - INTERVAL '30 days') AS tasks_completed_30d,
    COUNT(t.id) FILTER (WHERE t.status IN ('ASSIGNED','IN_PROGRESS','PAUSED')) AS tasks_open,
    AVG(vr.delta_hours)  FILTER (WHERE vr.recorded_at >= now() - INTERVAL '30 days') AS avg_variance_30d,
    AVG(vr.delta_percent) FILTER (WHERE vr.recorded_at >= now() - INTERVAL '30 days') AS avg_variance_pct_30d
FROM users u
LEFT JOIN job_tasks t      ON t.assigned_to_user_id = u.id
LEFT JOIN variance_records vr ON vr.task_id = t.id
WHERE u.is_active = TRUE
GROUP BY u.id, u.full_name, u.short_code;

-- Per-template calibration: how the catalog estimates compare to reality
CREATE VIEW v_template_calibration AS
SELECT
    tv.template_code,
    oc.canonical_name                    AS operation_name,
    to_.estimated_hours                  AS template_estimate,
    AVG(t.actual_hours)                  AS avg_actual,
    AVG(t.actual_hours) - to_.estimated_hours AS avg_delta,
    COUNT(t.id)                          AS sample_size,
    STDDEV_POP(t.actual_hours)           AS stddev_actual
FROM template_versions tv
JOIN template_operations to_ ON to_.template_version_id = tv.id
JOIN operation_catalog oc    ON oc.id = to_.operation_id
LEFT JOIN repair_orders ro   ON ro.template_version_id = tv.id
LEFT JOIN job_tasks t        ON t.ro_id = ro.id AND t.operation_id = oc.id AND t.status = 'COMPLETED'
WHERE tv.superseded_at IS NULL
GROUP BY tv.template_code, oc.canonical_name, to_.estimated_hours;


-- =====================================================================
-- SECTION 10. KEY DOMAIN CONSTRAINTS AND TRIGGERS
-- =====================================================================

-- A user can only have ONE open time entry at a time (you can't be
-- clocked in to two tasks simultaneously).
CREATE UNIQUE INDEX idx_one_open_time_entry_per_user
    ON time_entries (user_id) WHERE clock_out IS NULL;

-- When a time_entry is closed, recompute the task's actual_hours.
CREATE OR REPLACE FUNCTION recompute_task_actual_hours()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'UPDATE' AND OLD.clock_out IS NULL AND NEW.clock_out IS NOT NULL)
       OR (TG_OP = 'INSERT' AND NEW.clock_out IS NOT NULL)
       OR (TG_OP = 'DELETE') THEN
        UPDATE job_tasks
           SET actual_hours = COALESCE((
               SELECT ROUND(SUM(duration_minutes)::numeric / 60.0, 2)
                 FROM time_entries
                WHERE task_id = COALESCE(NEW.task_id, OLD.task_id)
                  AND clock_out IS NOT NULL
                  AND activity_type = 'WORK'
           ), 0)
         WHERE id = COALESCE(NEW.task_id, OLD.task_id);
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_time_entry_recompute
    AFTER INSERT OR UPDATE OR DELETE ON time_entries
    FOR EACH ROW EXECUTE FUNCTION recompute_task_actual_hours();


-- =====================================================================
-- END OF MIGRATION 001
-- =====================================================================
