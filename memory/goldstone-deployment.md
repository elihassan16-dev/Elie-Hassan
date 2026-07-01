---
name: goldstone-deployment
description: Goldstone Properties app — production stack, live URLs, and outstanding follow-ups
metadata:
  type: project
---

Migrated the single-file `goldstone.jsx` into a production **React + Vite + Supabase** PWA (work done 2026-06-30 → 2026-07-01). It is **built, deployed, and working** (login + real data confirmed by the user).

**Live app:** https://elie-hassan.vercel.app (auto-deploys on push to `main`).
**GitHub:** https://github.com/elihassan16-dev/Elie-Hassan (repo name is "Elie-Hassan").
**Supabase project ref:** `wtmsukjnuqsprtvfytin` — schema in `supabase/schema.sql` was run; 6 tables (users, properties, leads, tasks, contacts, automations) with RLS + realtime.
**Admin:** elihassan16@gmail.com is hard-coded admin in the SQL trigger; everyone else defaults to `member`. Invite-only (no public sign-up).

Node.js was NOT installed originally — installed Node 24 via winget. Local build works (`npm run build`); Vercel builds in the cloud. Supabase URL + anon key are also baked into `src/supabaseClient.js` as a fallback (they are public; RLS protects data) after a corrupted Vercel env var caused an "ISO-8859-1" fetch error.

Mobile layout: shell has bottom tab bar under 768px; Properties + Leads use a drill-in (full-width list → full-width detail with back button). Verified zero horizontal overflow at 375px.

**Edit-persistence race fixed (2026-07-01):** earlier `setSharedProps` fired an immediate async whole-property DB write per edit; rapid edits produced overlapping out-of-order writes (older overwrote newer) and realtime refresh could revert unsaved edits → "actual numbers revert to zero." Rewrote `src/data/DataProvider.jsx` with `useSyncedCollection`: local state updates instantly, a single debounced (500ms) single-flight flush writes only changed rows in order; realtime `load()` preserves locally-dirty (unsaved) rows and won't resurrect locally-deleted ones; flushes on tab-hide. Applies to properties/leads/automations.

**Multi-session note:** the user also works from a **work desktop / separate Claude session** that pushed 12 commits (mobile fixes, property archive+Settings, QuickBooks transaction drill-down, auto-sync, address matching, EULA/Privacy pages) on top of this laptop's work. Had to `git fetch` + `git rebase origin/main` (my local was behind) before pushing — DataProvider.jsx was untouched remotely so no conflict. LESSON: always `git fetch`/pull before committing here, since another session pushes to the same repo.

**Outstanding when the user returns:**
- User to verify the mobile layout on their actual iPhone (needs to clear PWA cache: delete home-screen icon, reload in Safari private tab, re-add). They were possibly viewing on desktop, where the layout is unchanged by design.
- Delete throwaway test user `mobiletest@goldstone.dev` in Supabase Auth → Users (created during mobile testing; shows as a phantom team member).
- Optional: set Supabase Auth → URL Configuration → Site URL to the Vercel URL.
- Possible further mobile polish: financial detail grids and the cost popups (BuyingCostsPopup etc. still use fixed multi-column grids).
