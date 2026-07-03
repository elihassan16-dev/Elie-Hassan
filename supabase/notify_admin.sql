-- ============================================================================
-- Goldstone Properties — admin control over who receives notifications
-- Paste into: Supabase Dashboard → SQL Editor → New query → Run (idempotent).
--
-- Adds a per-user "muted" flag. Admins can flip it from the app; the notification
-- sender skips anyone muted. (Turning notifications ON still has to be done by
-- that person on their own device — phones require it — but an admin can always
-- turn them OFF for someone here.)
-- ============================================================================

alter table public.users add column if not exists notify_muted boolean not null default false;

-- Let admins see who has registered a device for push (own rows already visible).
drop policy if exists push_admin_select on public.push_subscriptions;
create policy push_admin_select on public.push_subscriptions for select to authenticated using (public.is_admin());

-- ============================================================================
-- Done. (users already allows admins to update any row.)
-- ============================================================================
