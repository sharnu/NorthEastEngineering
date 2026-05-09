# Seed Accounts

All passwords: `nee2026`  
After any fresh seed, run `make hash-pw` (requires API running) to activate them.

## Named / Admin Accounts

| Username | Full Name | Role(s) |
|---|---|---|
| `sales` | Brenton Coleby | Sales |
| `drafter` | Hai Nguyen | Drafter |
| `supervisor` | Dwayne Fender | Supervisor, Station Owner |
| `adam` | Adam Miller | Station Owner (Body fitout B1) |

## Station Owners + Technicians

UUID pattern: `7a<station_id_decimal_6>-7777-7777-7777-000000000001` = owner, `7b…` = second tech.

| Username | Full Name | Station | Role(s) |
|---|---|---|---|
| `marcus` | Marcus Webb | Material processing / CNC (10) | Station Owner, Technician |
| `tom` | Tom Sissons | Material processing / CNC (10) | Technician |
| `dave` | Dave Norris | Fabrication line (20) | Station Owner, Technician |
| `peter` | Peter Rogers | Fabrication line (20) | Technician |
| `ricky` | Ricky Santos | Fabrication line (20) | Technician |
| `wei` | Wei Zhang | Robotic fabrication (25) | Station Owner, Technician |
| `jack` | Jack Brennan | Robotic fabrication (25) | Technician |
| `liam` | Liam Cross | Paint and panel (30) | Station Owner, Technician |
| `kane` | Kane Bromhead | Paint and panel (30) | Technician |
| `shane` | Shane Dooley | Paint and panel (30) | Technician |
| `nathan` | Nathan Foley | Body fitout B1 (40) | Technician |
| `mick` | Mick Farrar | Body fitout B1 (40) | Technician |
| `scott` | Scott Barker | Chassis prep B3 (50) | Station Owner, Technician |
| `chris` | Chris Payne | Chassis prep B3 (50) | Technician |
| `garry` | Garry Sloane | HYVA hydraulics (60) | Station Owner, Technician |
| `brad` | Brad Hogan | HYVA hydraulics (60) | Technician |
| `tony` | Tony Burlack | Final fitment B2 (70) | Station Owner, Technician |
| `jamie` | Jamie Hunt | Final fitment B2 (70) | Technician |
| `ray` | Ray Gould | Pantech assembly (80) | Station Owner, Technician |
| `darren` | Darren Marsh | Pantech assembly (80) | Technician |
| `greg` | Greg Sims | Compliance / QC (90) | Station Owner, QC |
| `lisa` | Lisa Norris | Compliance / QC (90) | QC |

## Migration 028 — PDF-aligned station owners

Migration 028 introduces the people named in the NE Operation flow PDF and
makes them the primary tech / station owner where the PDF says so. The
existing mock techs above stay on their stations as secondaries.

| Username | Full Name | Station | Role(s) |
|---|---|---|---|
| `kai`    | Kai Tan         | Robotic fabrication (25)                | Station Owner, Technician |
| `shanks` | Shanks Williams | Body fitout, Chassis prep, Final fitment (40/50/70) | Station Owner, Technician |
| `danny`  | Danny Galvin    | HYVA hydraulics (60)                    | Station Owner, Technician |
| `viral`  | Viral Patel     | Pantech assembly (80)                   | Station Owner, Technician |
| `sammy`  | Sammy Reeves    | Compliance / QC (90)                    | Station Owner, QC |
| `sid`    | Sid Patel       | Compliance / QC (90)                    | Station Owner, QC |

Station moves applied by 028 (existing users repointed to PDF-correct stations):

| Username | Old station | New station |
|---|---|---|
| `adam`  | Body fitout B1 (40) | Fabrication line / Production line (20) |
| `scott` | Chassis prep B3 (50) | Paint and panel (30) |

Post-028 station ownership (`stations.owner_user_id`):

| Station | Owner |
|---|---|
| MATERIAL_PROC (10) | Marcus Webb |
| FAB_LINE (20) | Adam Miller |
| ROBOTIC_FAB (25) | Kai Tan |
| PAINT_PANEL (30) | Scott Barker |
| BODY_FITOUT (40) | Shanks Williams |
| CHASSIS_PREP (50) | Shanks Williams |
| HYVA (60) | Danny Galvin |
| FINAL_FITMENT (70) | Shanks Williams |
| PANTECH (80) | Viral Patel |
| COMPLIANCE_QC (90) | Sammy Reeves (Sid Patel is also primary tech) |
