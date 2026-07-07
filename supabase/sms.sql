-- ============================================================================
-- Goldstone Properties — free text-message notifications (email→SMS gateways)
-- Paste into: Supabase Dashboard → SQL Editor → New query → Run (idempotent).
--
-- Adds users.sms_email: the carrier's email-to-SMS gateway address for each
-- teammate (e.g. 6095551234@vtext.com). When set, /api/notify/send also fires
-- a short text through Resend whenever that person gets a message, mention, or
-- task assignment. Set per-user from the profile menu (admin → Team list → 📱).
-- ============================================================================

alter table public.users add column if not exists sms_email text;

-- ============================================================================
-- Done. No new policies needed — admins already update user rows (mute toggle).
-- ============================================================================
