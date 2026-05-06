-- Migration 016: kanban override marker
-- Stores the most-recent manual override on ro_kanban_state so the board
-- can display the ⚠ badge without querying domain_events on every board load.
-- Cleared when auto-advance overwrites the stage (future story).

ALTER TABLE ro_kanban_state
  ADD COLUMN IF NOT EXISTS last_override_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_override_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_override_by     UUID REFERENCES users(id);
