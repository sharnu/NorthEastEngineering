-- Grant ADMIN role (id = 1) to the supervisor seed account.
-- Idempotent via ON CONFLICT DO NOTHING.
INSERT INTO user_roles (user_id, role_id)
VALUES ('33333333-3333-3333-3333-333333333333', 1)
ON CONFLICT DO NOTHING;
