# Documentation

Project documentation lives here. Three things:

| File | Purpose |
|---|---|
| [`backlog.md`](backlog.md) | The work plan. Epics, user stories, priorities, dependencies. Read this to know what to work on. |
| [`glossary.md`](glossary.md) | Domain terminology. Read this when a name is ambiguous (RO, job task, operation, template, etc.). |
| [`adr/0001-stack-choice.md`](adr/0001-stack-choice.md) | Why we chose .NET 10 + Postgres + Angular + in-app auth + no cloud. |

## Adding new ADRs

When making an architectural decision that's worth writing down (auth model change, new external dependency, schema redesign, etc.), copy the format of `0001-stack-choice.md` and create `0002-<topic>.md`. Keep ADRs short — one page is the goal.

## Updating the glossary

Add new terms as they come up. Keep entries to: term name, one-paragraph definition, schema reference, example. Don't write essays.

## The backlog is the source of truth for work

Stories ship as PRs that reference the story id (`E2-S1`, `E3-S2`, etc.) in the commit message. Updates to the backlog (changing scope, marking stories done) happen via PR same as code.
