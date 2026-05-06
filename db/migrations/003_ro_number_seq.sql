-- Migration 003: RO number sequence
-- Provides a monotonically-increasing integer used to generate human-readable
-- RO numbers in the format 'RO00001'. The sequence is safe under concurrent
-- inserts (no race between two sales staff creating ROs simultaneously).

CREATE SEQUENCE IF NOT EXISTS ro_number_seq
    START 1
    INCREMENT BY 1
    MINVALUE 1
    NO MAXVALUE
    CACHE 1;
