# ADR 0001 — Stack choice

**Status:** Accepted · April 2026
**Decision owners:** Software architecture team
**Supersedes:** None

## Context

NEE needs a production platform to replace the spreadsheet-and-Power-BI workflow currently used to manage 109 in-progress repair orders. The platform has to handle template-driven RO creation, live shop-floor task tracking via phones, supervisor dashboards, scheduling against readiness gates, customer-facing QC emails, and reporting. Two-week MVP horizon, two senior developers, local-only target for the first cut (no cloud deploy in MVP scope).

The team has deep .NET experience. The shop floor expects a tablet/phone-friendly UI. Customers (DFE, Modern Truck Repairs, etc.) interact with NEE through email, not the platform itself. Data volumes are modest — hundreds of ROs per year, low thousands of tasks per year, well within any modern relational database's comfort zone.

## Decision

The platform is built as:

- **Backend:** .NET 10 minimal API, C# 14, EF Core 10
- **Database:** PostgreSQL 16
- **Frontend:** Angular 18 (standalone components, signal-based state)
- **Auth:** In-app JWT, password hashes in our own `users` table
- **Local infra:** Docker Compose for Postgres and Mailpit (local SMTP capture)
- **No cloud deployment in the MVP.** Azure deferred to Phase 2.

## Alternatives considered

### Backend runtime: .NET 10 vs .NET 9 vs Node.js
- **.NET 9** is an STS release with support ending May 2026 — about a month after MVP. Picking it forces a runtime upgrade in Q1 of the project.
- **Node.js** would let us share TypeScript across frontend and backend. Rejected because the team's .NET expertise is significantly deeper, the velocity advantage of LLM-assisted .NET is comparable to Node, and EF Core's relational mapping is a closer fit to our schema-first approach than any Node ORM.
- **.NET 10** is LTS until November 2028, fits the team's expertise, and Claude Code is well-trained on the latest C# 14 / EF Core 10 APIs.

### Database: PostgreSQL vs SQL Server vs MySQL
- **SQL Server** would be a natural fit for a .NET shop, but its licensing model is hostile to local-only development at multiple stations. Postgres runs identically in a 50MB Docker image.
- **MySQL** lacks the JSON/JSONB ergonomics we use for `domain_events` and the rich constraint/exclusion features we lean on (partial unique indexes for "one open time entry per user", computed columns, triggers).
- **PostgreSQL 16** has CITEXT for case-insensitive emails out of the box, mature JSONB, generated columns, and a mainstream Docker story. Same engine works locally and in any cloud later.

### Frontend: Angular vs React vs Vue
- **React** is more popular but the platform is a forms-and-tables-heavy enterprise app, not a content site. Angular's forms, routing, and DI conventions remove decisions the team would otherwise have to make in React.
- **Vue** lacks the ecosystem for the more complex screens (kanban, technician phone) and would mean re-finding solutions Angular ships with.
- **Angular 18 standalone components** with signals give us the modern reactive primitives without NgModule boilerplate. The team is comfortable here.

### Auth: in-app JWT vs Azure Entra (AD) vs Auth0
- **Azure Entra** is the obvious right answer for an Australian SMB on Microsoft 365. Deferred because (a) the local-only MVP doesn't need it, (b) it would require Azure setup that's explicitly out of scope for this 2-week sprint, and (c) the schema's `users` and `roles` tables are designed to make the Entra cutover later a low-disruption change.
- **Auth0** is a third-party dependency we'd have to manage and pay for. Same deferral logic as Entra.
- **In-app JWT** with bcrypt-style password hashing in the `users` table works locally with no external dependencies. It's a known temporary solution; ADR 0002 will cover the Entra migration when we cross that bridge.

### Local-only vs Azure deployment in MVP
The 2-week MVP scope explicitly excludes Azure deployment. Azure setup (App Service, Postgres Flexible Server, Key Vault, App Registration, networking) is unpredictable and historically eats 2 days of the timeline before any feature work. Deferring lets us spend that time on user-facing capabilities. Phase 2 (post-MVP) addresses cloud deployment as its own dedicated work item.

## Consequences

**Positive:**
- Clone-and-run dev experience is a single `make dev` command. No cloud accounts required to onboard a new developer.
- The schema is identical between local Docker Postgres and any future cloud Postgres, so the "lift to Azure" work is configuration, not code.
- .NET 10 LTS removes runtime upgrade pressure during the project's first year.
- Standard tooling everywhere — every choice is one a senior .NET developer would recognise on day one.

**Negative / debt:**
- In-app JWT is not what NEE will run in production long-term. The day Entra integration is needed, we'll add a new auth path and migrate users. The schema is shaped to make this manageable but it's still work.
- No CI/CD until Phase 2. Tests run locally; merges to `main` rely on developer discipline.
- No staging environment in the MVP. Demos run on a developer's machine. Acceptable for a 2-week MVP, not acceptable for ongoing operations.
- Mailpit replaces a real SMTP relay. The QC email feature can be demo'd but emails don't actually reach customer inboxes until we wire a real SMTP path post-MVP.

**Neutral:**
- The frontend is a single Angular app, not a PWA. Phone users get a mobile-responsive web app, not an installable one. This is fine for the MVP demo and converts cleanly to PWA later if needed.

## Review

This ADR will be revisited when:
- Phase 2 begins (cloud deployment + Entra migration becomes the work)
- Data volume crosses ~10,000 ROs/year (revisit Postgres tuning)
- A second customer-facing surface is added (revisit auth approach)
