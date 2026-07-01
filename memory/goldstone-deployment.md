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

**Outstanding when the user returns:**
- User to verify the mobile layout on their actual iPhone (needs to clear PWA cache: delete home-screen icon, reload in Safari private tab, re-add). They were possibly viewing on desktop, where the layout is unchanged by design.
- Delete throwaway test user `mobiletest@goldstone.dev` in Supabase Auth → Users (created during mobile testing; shows as a phantom team member).
- Optional: set Supabase Auth → URL Configuration → Site URL to the Vercel URL.
- Possible further mobile polish: financial detail grids and the cost popups (BuyingCostsPopup etc. still use fixed multi-column grids).
