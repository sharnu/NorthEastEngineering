-- Migration 008: add email_dl column to customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_dl CITEXT;
