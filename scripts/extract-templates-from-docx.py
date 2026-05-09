#!/usr/bin/env python3
"""
Extract job-card templates from `Job Card Description.docx` and emit a
SQL migration that seeds them.

Pipeline:
  1. Parse the docx into structured records: { code, description, ops:[ {name,
     section, hours} ] }
  2. Fuzzy-map each op to operation_catalog (by canonical_name), with
     fallbacks to a hand-curated alias table.
  3. Report unmapped ops (these become new operation_catalog rows in the
     output migration).
  4. Emit `db/migrations/024_seed_extracted_templates.sql` with:
        - INSERT new operation_catalog rows
        - INSERT job_code_templates rows
        - INSERT template_versions rows (deterministic UUIDs)
        - INSERT template_operations rows
     All idempotent (`ON CONFLICT … DO NOTHING`).

Run from repo root:
    python3 scripts/extract-templates-from-docx.py \
            --docx ~/Downloads/Job\\ Card\\ Description.docx
"""
from __future__ import annotations

import argparse
import hashlib
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from docx import Document

# ─── Static reference data (mirrors the seed) ───────────────────────────────
# Body type codes → DB body_types.id
BODY_TYPE_BY_PREFIX = {
    "TR": (1, "TR"),  # Tray
    "TP": (2, "TP"),  # Tipper
    "TT": (3, "TT"),  # Tautliner
    "DP": (4, "DP"),  # Drop-side / Pantech (also covers the BGT/IAL/DFE-DP variants)
    "VP": (4, "DP"),  # Vacuum pantech maps to Drop-side / Pantech body type for now
    "CH": (5, "CH"),  # Chipper
    "TS": (6, "TS"),  # Tilt slider
}

# Stations (id → label): only used in comments
STATIONS = {
    10: "Material processing / CNC",
    20: "Fabrication line",
    25: "Robotic fabrication",
    30: "Paint and panel",
    40: "Body fitout (B1)",
    50: "Chassis prep (B3)",
    60: "HYVA hydraulics",
    70: "Final fitment (B2)",
    80: "Pantech assembly",
    90: "Vehicle compliance and final QC",
}

# Operations already in operation_catalog — code → (id, default_station_id)
EXISTING_OPS = {
    "MAT_PROC_CNC":        (10, 10),
    "MAT_PROC_FIBRE":      (11, 10),
    "MFR_BASE":            (20, 20),
    "MFR_FRONT_WALL":      (21, 20),
    "MFR_REAR_WALL":       (22, 20),
    "MFR_ROOF":            (23, 20),
    "MFR_HEADBOARD":       (24, 20),
    "MFR_DROPSIDES":       (25, 20),
    "MFR_REAR_FRAME":      (26, 20),
    "MFR_REAR_DOORS":      (27, 20),
    "MFR_SUBFRAME":        (28, 20),
    "MFR_TAILGATE":        (29, 20),
    "MFR_TOOLBOX":         (30, 20),
    "FAB_LINE_ASSY":       (31, 20),
    "TRAY_ASSY":           (32, 20),
    "BODY_FITOUT":         (40, 40),
    "CHASSIS_PREP_FLITCH": (41, 50),
    "SUBFRAME_PTO_HYD":    (42, 60),
    "PAINT_PREP_RUB":      (50, 30),
    "PAINT_PRIME_SEAL":    (51, 30),
    "PAINT_FINAL":         (52, 30),
    "PAINT_SUBFRAME":      (53, 30),
    "PAINT_UNDERSIDE":     (54, 30),
    "PAINT_ROLL_FLOOR":    (55, 30),
    "FITMENT_INSTALL":     (60, 70),
    "WIRING_LIGHTS":       (61, 70),
    "FIT_ACCESSORIES":     (62, 70),
    "BLUE_PLATE_QC":       (70, 90),
}

# New catalog rows we'll add (only needed for ops the doc has but the catalog doesn't).
# Populated dynamically when an op can't be mapped.
NEW_OPS_NEXT_ID = 100  # Start IDs for new ops well above existing ones

# ─── Alias table — maps doc operation phrasing to operation_catalog code ────
# Order matters; first-match wins.
ALIASES = [
    # Material proc
    (r"^MATERIAL\s*PROCESSING",                       "MAT_PROC_CNC"),
    (r"FIB(?:RE|ER).*GLOSS.*PROC|FIB(?:RE|ER).*PANEL", "MAT_PROC_FIBRE"),

    # Manufacture-* (specific shapes — must come before generic "MANUFACTURE")
    (r"^MANUFACTURE\s+BASE\b",                                       "MFR_BASE"),
    (r"^MANUFACTURE\s+HEADBOARD",                                    "MFR_HEADBOARD"),
    (r"^MANUFACTURE.*FRONT\s+WALL|^MANUFACTURE.*FRONT-WALL",         "MFR_FRONT_WALL"),
    (r"^MANUFACTURE.*REAR\s+WALL|^MANUFACTURE.*REAR-WALL",           "MFR_REAR_WALL"),
    (r"^MANUFACTURE\s+ROOF|ALUMINIUM\s+ROOF\s+PANEL",                "MFR_ROOF"),
    (r"^MANUFACTURE.*\bDROPSIDES?\b",                                "MFR_DROPSIDES"),
    (r"^MANUFACTURE\s+(REAR\s+FRAME|REAR-FRAME)",                    "MFR_REAR_FRAME"),
    (r"^MANUFACTURE.*(REAR\s+DOORS|BARN\s+DOORS|REAR\s+BARN)",       "MFR_REAR_DOORS"),
    (r"^MANUFACTURE.*SIDE\s+ACCESS\s+DOOR",                          "MFR_REAR_DOORS"),
    (r"^MANUFACTURE\s+SUBFRAME",                                     "MFR_SUBFRAME"),
    (r"^MANUFACTURE.*\bTAILGATE\b",                                  "MFR_TAILGATE"),
    (r"^MANUFACTURE.*TOOLBOX",                                       "MFR_TOOLBOX"),
    (r"^MANUFACTURE.*SIGN\s*RACK|^MANUFACTURE.*SIGNRACK",            "MFR_SIGN_RACK"),
    (r"^MANUFACTURE\s+POLE\s+SAW",                                   "MFR_POLE_SAW_BOX"),

    # Assembly
    (r"^TRAY\s+ASSEMBLY",                "TRAY_ASSY"),
    (r"^FAB\s*LINE\s+ASSEMBLY",          "FAB_LINE_ASSY"),
    (r"^FABRICATION\s+LINE",             "FAB_LINE_ASSY"),
    (r"^BODY\s+ASSEMBLY",                "FAB_LINE_ASSY"),

    # Fitout / chassis
    (r"^BODY\s+FITOUT",                  "BODY_FITOUT"),
    (r"^CHASSIS\s+PREP",                 "CHASSIS_PREP_FLITCH"),
    (r"^TRAY\s+FITMENT",                 "CHASSIS_PREP_FLITCH"),
    (r"^FITMENT.*INSTALL",               "FITMENT_INSTALL"),
    (r"^TRAY\s+INSTALL",                 "FITMENT_INSTALL"),
    (r"^BODY\s+INSTALL",                 "FITMENT_INSTALL"),
    (r"^FIT\s+(?:BODY|BOX).*CHASSIS",    "FITMENT_INSTALL"),
    (r"^INSTALL\s+BODY",                 "FITMENT_INSTALL"),

    # Paint / NEPP — match anywhere in the line for the prep/prime/final keywords
    (r"PAINT\s+PREP",                    "PAINT_PREP_RUB"),
    (r"^PRIME.*(SEAL|RUB|BLACK)",        "PAINT_PRIME_SEAL"),
    (r"^FINAL\s+PAINT",                  "PAINT_FINAL"),
    (r"^ROLL\s+FLOOR",                   "PAINT_ROLL_FLOOR"),
    (r"^PAINT\s+SUBFRAME",               "PAINT_SUBFRAME"),
    (r"^UNDERSIDE\s+BLACK",              "PAINT_UNDERSIDE"),

    # Subframe / hydraulics
    (r"SUBFRAME.*PTO|SUBFRAME.*HYD",     "SUBFRAME_PTO_HYD"),
    (r"^HYVA",                           "SUBFRAME_PTO_HYD"),
    (r"HYDRAULIC",                       "SUBFRAME_PTO_HYD"),

    # Wiring / accessories
    (r"WIRING.*(LIGHTS|TAIL)",           "WIRING_LIGHTS"),
    (r"^(TRAY|TIPPER|BODY)\s+WIRING",    "WIRING_LIGHTS"),
    (r"^FIT.*ACCESSORIES",               "FIT_ACCESSORIES"),
    (r"TUCK-A-WAY|TAILGATE\s+LOADER",    "FIT_ACCESSORIES"),

    # Pantech-specific finishing
    (r"^SILICON.*SEAL",                  "PANTECH_SILICON_SEAL"),

    # QC (keep last so QC mentions in long op names don't pre-empt others)
    (r"^BLACK\s+PLATE",                  "BLUE_PLATE_QC"),
    (r"^BLUE\s+PLATE",                   "BLUE_PLATE_QC"),
    (r"^FINAL\s+QC",                     "BLUE_PLATE_QC"),
    (r"^VEHICLE\s+COMPLIANCE",           "BLUE_PLATE_QC"),
]

# Aliased-but-new ops that we need to add to operation_catalog.
# code -> (canonical_name, default_station_id, typical_hours, description)
NEW_OPS = {
    "MFR_SIGN_RACK":         ("Manufacture sign rack",
                              20, 1.5,
                              "Stand-alone sign rack fabrication for tipper accessory variants."),
    "MFR_POLE_SAW_BOX":      ("Manufacture pole-saw box components",
                              20, 4.0,
                              "Chipper-body pole-saw stowage box; used by CH templates."),
    "PANTECH_SILICON_SEAL":  ("Silicon and sealing",
                              80, 1.5,
                              "Pantech panel-joint sealing using marine silicon. Done at the pantech bench."),
}

# ─── Section heading → flow_track ────────────────────────────────────────────
def flow_track_for(section: str | None, op_code: str) -> str:
    """Return BODY / CHASSIS / SUBFRAME based on the section heading or op."""
    if not section:
        return "BODY"
    s = section.upper()
    if "CHASSIS" in s:
        return "CHASSIS"
    if "SUBFRAME" in s:
        return "SUBFRAME"
    if op_code == "CHASSIS_PREP_FLITCH":
        return "CHASSIS"
    if op_code == "SUBFRAME_PTO_HYD":
        return "SUBFRAME"
    return "BODY"

# ─── Body / job type from code ──────────────────────────────────────────────
JOB_TYPE_NEW_BUILD = 1
JOB_TYPE_BODY_SWAP = 2

def parse_code(code: str) -> tuple[str, Optional[str], str, int, Optional[str]]:
    """
    Returns (base_code, customer_code, body_type_code, body_type_id, variant_suffix).
    Examples:
        "TP42N"            -> ("TP42N", None, "TP", 2, None)
        "BGT-DP67F-SD"     -> ("DP67F-SD", "BGT", "DP", 4, "SD")
        "TP32N-T600S300"   -> ("TP32N", None, "TP", 2, "T600S300")
        "IAL-TT91F (Old Chassis)" -> ("TT91F", "IAL", "TT", 3, "OLD_CHASSIS")
    """
    raw = code.strip()
    # Strip anything in parentheses; remember as variant suffix if useful
    paren_match = re.search(r"\((.*?)\)", raw)
    paren_suffix = None
    if paren_match:
        paren_suffix = re.sub(r"[^A-Za-z0-9]+", "_", paren_match.group(1)).strip("_").upper()
        raw = raw[: paren_match.start()].strip()

    # Match the first hyphen-segment as a customer prefix when:
    #  • it's a known short customer code (DFE/BGT/IAL/...), AND
    #  • the next segment looks like a body code (XX99X{0..3})
    KNOWN_CUSTOMERS = {"DFE", "BGT", "IAL"}
    customer = None
    parts = raw.split("-")
    if (
        len(parts) >= 2
        and parts[0] in KNOWN_CUSTOMERS
        and re.fullmatch(r"[A-Z]{2,4}\d{2}[A-Z]{0,3}", parts[1])
    ):
        customer = parts[0]
        rest = "-".join(parts[1:])
    else:
        rest = raw

    # Now `rest` is e.g. "DP67F-SD" or "TP32N" or "TT91F"
    body_type_code = rest[:2].upper()
    if body_type_code not in BODY_TYPE_BY_PREFIX:
        # Default: treat as Tray
        body_type_code = "TR"
    body_type_id, _ = BODY_TYPE_BY_PREFIX[body_type_code]

    # Base code = first segment; variant suffix = the rest, joined with "_"
    base_segments = rest.split("-")
    base_code = base_segments[0]
    variant_suffix = "-".join(base_segments[1:]) if len(base_segments) > 1 else None
    if paren_suffix:
        variant_suffix = paren_suffix if not variant_suffix else f"{variant_suffix}-{paren_suffix}"

    return base_code, customer, body_type_code, body_type_id, variant_suffix


# ─── Parser ─────────────────────────────────────────────────────────────────
@dataclass
class Op:
    name: str
    section: Optional[str]
    hours: float
    op_code: Optional[str] = None        # mapped catalog code, set later
    flow_track: str = "BODY"

@dataclass
class Template:
    code: str
    description: str
    base_code: str
    customer: Optional[str]
    body_type_code: str
    body_type_id: int
    variant_suffix: Optional[str]
    job_type_id: int = JOB_TYPE_NEW_BUILD
    operations: list[Op] = field(default_factory=list)
    @property
    def total_hours(self) -> float:
        return round(sum(o.hours for o in self.operations), 2)


def parse_docx(path: Path) -> list[Template]:
    """Parse the docx into Template records, segmented by 'END OF JOB CARD'.

    Inside each segment, operations are bounded by 'TIME ALLOCATED X HRS'.
    The op name is the FIRST significant line collected since the previous
    TIME (or the segment start). Section context persists across ops so we
    can derive flow_track later.
    """
    doc = Document(str(path))
    paras = [p.text for p in doc.paragraphs]

    DOC_TITLE = "Northeast Engineering New Job Codes"

    segments: list[list[str]] = []
    buf_start = 0
    for i, p in enumerate(paras):
        if "END OF JOB CARD" in p:
            segments.append(paras[buf_start:i])
            buf_start = i + 1

    # Lines containing any of these keywords act as both section markers and
    # the start of a new operation block. We reset the block on hit so that
    # spec-bullet preambles (top-of-segment description lines that list e.g.
    # floor type, headboard size) don't bleed into the first op's name.
    SECTION_KEYS = (
        "MATERIAL PROCESSING", "FIBRE GLOSS PANEL", "FIBER GLOSS",
        "PAINT AND PANEL", "NEPP",
        "BODY FITOUT", "BODY ASSEMBLY",
        "CHASSIS PREP", "TRAY FITMENT", "TRAY INSTALL", "TRAY WIRING",
        "FITMENT: INSTALL", "FITMENT INSTALL",
        "WIRING OF CLEARANCE", "TIPPER WIRING",
        "FAB LINE ASSEMBLY", "FABRICATION LINE",
        "TRAY ASSEMBLY",
        "MANUFACTURE BASE", "MANUFACTURE HEADBOARD", "MANUFACTURE FRONT",
        "MANUFACTURE REAR", "MANUFACTURE ROOF", "MANUFACTURE DROPSIDE",
        "MANUFACTURE TAILGATE", "MANUFACTURE TOOLBOX", "MANUFACTURE SIGNRACK",
        "MANUFACTURE SIDE", "MANUFACTURE SUBFRAME",
        "SUBFRAME", "HYVA",
        "PAINT PREP", "PRIME", "FINAL PAINT", "PAINT SUBFRAME",
        "ROLL FLOOR", "UNDERSIDE BLACK",
        "BLUE PLATE", "FINAL QC", "VEHICLE COMPLIANCE",
    )

    SKIP_PREFIXES = ("CUSTOMER:", "NEE RO:", "TECHNICIAN NAME")

    time_re = re.compile(r"TIME\s+ALLOCATED\s+(?:HRS\s+)?([\d.]+)\s*HRS?", re.I)

    templates: list[Template] = []
    for seg in segments:
        code = ""
        desc = ""
        ops: list[Op] = []
        # Lines accumulated since the last TIME ALLOCATED. The first one
        # (after filtering) becomes the op name.
        block: list[str] = []
        current_section: Optional[str] = None

        for line in seg:
            s = line.strip()
            if not s or s == "." or s == DOC_TITLE:
                continue
            if any(s.upper().startswith(p) for p in SKIP_PREFIXES):
                continue

            if not code:
                code = s
                continue
            if not desc:
                desc = s
                continue

            m = time_re.search(s)
            if m:
                hours = float(m.group(1))
                # Op name = first ALL CAPS short line in the block, else fallback
                op_name = None
                for ln in block:
                    if ln.upper() == ln and len(ln) < 80:
                        op_name = ln
                        break
                if op_name is None:
                    op_name = block[0] if block else (current_section or "Unnamed")
                ops.append(Op(name=op_name, section=current_section, hours=hours))
                block = []
                continue

            # If this line marks the start of a new operation block, reset
            # the buffer so any preceding spec-bullets are discarded.
            is_section = any(k in s.upper() for k in SECTION_KEYS) and len(s) < 80
            if is_section:
                current_section = s
                block = [s]
            else:
                block.append(s)

        if not code or code == DOC_TITLE:
            continue

        base, cust, btc, btid, vs = parse_code(code)
        templates.append(Template(
            code=code if "(" not in code else code.split("(")[0].strip(),
            description=desc,
            base_code=base,
            customer=cust,
            body_type_code=btc,
            body_type_id=btid,
            variant_suffix=vs,
            operations=ops,
        ))

    return templates


# ─── Mapping ────────────────────────────────────────────────────────────────
def map_op_to_catalog(name: str) -> Optional[str]:
    """Return the catalog code, or None if unmapped."""
    s = name.strip().upper()
    for pattern, code in ALIASES:
        if re.search(pattern, s):
            return code
    return None


# ─── SQL emission ───────────────────────────────────────────────────────────
def deterministic_uuid(seed: str) -> str:
    """Stable UUID per template_code so re-runs are idempotent."""
    h = hashlib.sha1(seed.encode()).hexdigest()
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"


def sql_str(s: Optional[str]) -> str:
    if s is None:
        return "NULL"
    return "'" + s.replace("'", "''") + "'"


def emit_migration(templates: list[Template], unmapped: list[tuple[Template, Op]]) -> str:
    # Build the set of template codes so base_code references are FK-safe.
    # The doc occasionally lists variants (e.g. TP42F-S300) without ever
    # defining the base (TP42F) as its own template — emit base_code = NULL
    # in that case rather than break the foreign key.
    EXISTING_BASE_CODES = {"TP42N", "TT67F"}  # already in seed 002
    valid_codes = EXISTING_BASE_CODES | {t.code for t in templates}
    out = []
    out.append("-- 024_seed_extracted_templates.sql")
    out.append("-- Seeds 47 job-card templates extracted from")
    out.append("-- 'Job Card Description.docx'. Idempotent via ON CONFLICT DO NOTHING.")
    out.append("--")
    out.append("-- Generated by scripts/extract-templates-from-docx.py")
    out.append("BEGIN;")
    out.append("")

    # ── New operation_catalog rows ───────────────────────────────────────
    out.append("-- ── New operation_catalog rows ──")
    for code, (canon, station, hours, descr) in NEW_OPS.items():
        # Allocate an id that doesn't collide with existing
        next_id = NEW_OPS_NEXT_ID + sorted(NEW_OPS).index(code)
        out.append(
            f"INSERT INTO operation_catalog (id, code, canonical_name, default_station_id, typical_hours, description, is_active)"
            f"\nVALUES ({next_id}, {sql_str(code)}, {sql_str(canon)}, {station}, {hours}, {sql_str(descr)}, TRUE)"
            f"\nON CONFLICT (code) DO NOTHING;"
        )
    out.append("")

    # ── job_code_templates ───────────────────────────────────────────────
    # Emit templates in dependency order: bases (no base_code reference)
    # first, then variants. Templates already in seed 002 are skipped.
    seed_002_codes = {"TP42N", "TT67F", "DFE-TT67F"}
    sorted_templates = sorted(
        templates,
        key=lambda t: (1 if (t.base_code != t.code and t.base_code in valid_codes) else 0, t.code),
    )

    out.append("-- ── Templates ──")
    for t in sorted_templates:
        if t.code in seed_002_codes:
            out.append(f"-- (skipping {t.code} — already in seed 002)")
            continue

        if t.customer:
            customer_clause = f"(SELECT id FROM customers WHERE code = '{t.customer}')"
        else:
            customer_clause = "NULL"

        # Only set base_code when the referenced base actually exists.
        base_for_sql = t.base_code if (
            t.base_code != t.code and t.base_code in valid_codes
        ) else None

        out.append(
            f"INSERT INTO job_code_templates "
            f"(code, base_code, customer_id, body_type_id, job_type_id, name, description, body_size_mm, chassis_class, variant_suffix, current_version, is_active)\n"
            f"VALUES ({sql_str(t.code)}, {sql_str(base_for_sql)}, "
            f"{customer_clause}, {t.body_type_id}, {t.job_type_id}, "
            f"{sql_str(t.code + ' — ' + t.description[:80])}, "
            f"{sql_str(t.description)}, NULL, NULL, "
            f"{sql_str(t.variant_suffix)}, 1, TRUE)\n"
            f"ON CONFLICT (code) DO NOTHING;"
        )
    out.append("")

    # ── template_versions ────────────────────────────────────────────────
    out.append("-- ── Versions (deterministic UUIDs based on code) ──")
    out.append("INSERT INTO template_versions (id, template_code, version_number, effective_from, total_estimated_hours, body_type) VALUES")
    rows = []
    for t in templates:
        if t.code in ("TP42N", "DFE-TT67F"):
            continue  # Already seeded
        uuid = deterministic_uuid("v1:" + t.code)
        rows.append(
            f"  ({sql_str(uuid)}, {sql_str(t.code)}, 1, now(), {t.total_hours}, {sql_str(t.body_type_code)})"
        )
    out.append(",\n".join(rows))
    out.append("ON CONFLICT (template_code, version_number) DO NOTHING;")
    out.append("")

    # ── template_operations ──────────────────────────────────────────────
    out.append("-- ── Template operations ──")
    for t in templates:
        if t.code in ("TP42N", "DFE-TT67F"):
            continue
        version_uuid = deterministic_uuid("v1:" + t.code)
        out.append(f"-- {t.code} ({t.total_hours} h, {len(t.operations)} ops)")
        out.append(
            "INSERT INTO template_operations (id, template_version_id, sequence, operation_id, estimated_hours, flow_track, notes)\nVALUES"
        )
        op_rows = []
        for i, op in enumerate(t.operations, start=1):
            op_id_lookup = (
                f"(SELECT id FROM operation_catalog WHERE code = '{op.op_code}')"
                if op.op_code
                else "NULL"
            )
            op_uuid = deterministic_uuid(f"op:{t.code}:{i}")
            op_rows.append(
                f"  ({sql_str(op_uuid)}, {sql_str(version_uuid)}, {i}, "
                f"{op_id_lookup}, {op.hours}, {sql_str(op.flow_track)}, "
                f"{sql_str(op.name[:120])})"
            )
        out.append(",\n".join(op_rows))
        out.append("ON CONFLICT (id) DO NOTHING;")
        out.append("")

    if unmapped:
        out.append("-- ── Unmapped ops report (commented for visibility) ──")
        for t, op in unmapped:
            out.append(f"-- UNMAPPED: {t.code:24s}  {op.name}  ({op.hours} h, section={op.section})")
        out.append("")

    out.append("COMMIT;")
    return "\n".join(out)


# ─── Main ───────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--docx", required=True, help="Path to Job Card Description.docx")
    ap.add_argument("--out",  default="db/migrations/024_seed_extracted_templates.sql")
    args = ap.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    docx_path = Path(args.docx).expanduser()
    if not docx_path.exists():
        sys.exit(f"Input not found: {docx_path}")

    templates = parse_docx(docx_path)
    print(f"parsed {len(templates)} templates", file=sys.stderr)

    unmapped: list[tuple[Template, Op]] = []
    for t in templates:
        for op in t.operations:
            code = map_op_to_catalog(op.name)
            if code is None:
                unmapped.append((t, op))
                continue
            op.op_code = code
            op.flow_track = flow_track_for(op.section, code)

    if unmapped:
        print(f"\n=== UNMAPPED ({len(unmapped)}) ===", file=sys.stderr)
        seen = set()
        for t, op in unmapped:
            sig = op.name.upper().strip()[:60]
            if sig in seen:
                continue
            seen.add(sig)
            print(f"  {t.code:24s} {op.name}", file=sys.stderr)
    else:
        print("All operations mapped.", file=sys.stderr)

    out_path = (repo_root / args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(emit_migration(templates, unmapped))
    print(f"\nwrote {out_path}", file=sys.stderr)
    print(f"  templates: {len(templates)}", file=sys.stderr)
    print(f"  total operations: {sum(len(t.operations) for t in templates)}", file=sys.stderr)
    print(f"  unmapped: {len(unmapped)}", file=sys.stderr)


if __name__ == "__main__":
    main()
