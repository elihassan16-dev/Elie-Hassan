-- Per-user notification channels, admin-controlled from the app:
--   users.notify_channels = {"push": bool, "email": bool, "sms": bool}
-- Missing column value / missing key = that channel is ON (default everything on).
-- Applies to teammates AND contractor-portal logins alike; the existing
-- notify_muted stays as the master off-switch.
-- Paste into Supabase -> SQL Editor -> Run. Idempotent.

alter table public.users add column if not exists notify_channels jsonb;
