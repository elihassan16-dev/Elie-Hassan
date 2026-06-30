# Goldstone Properties

Real-estate portfolio, leads, tasks & deal-management app.
**React + Vite + Supabase**, installable as a PWA on iPhone, real-time multi-user sync.

---

## What's inside

| Area | Implementation |
|------|----------------|
| Auth | Supabase email/password, gold-branded login (`#B8953F`) |
| Roles | `admin` (full access) and `member` (assigned tasks + view properties) |
| Data | Postgres tables: `users`, `properties`, `leads`, `tasks`, `contacts`, `automations` (no more localStorage) |
| Realtime | `supabase.channel()` — every client sees changes live |
| Session | Real Supabase auth session replaces the old `CURRENT_USER` placeholder |
| PWA | `manifest.webmanifest` + iOS meta tags → "Add to Home Screen" |
| Mobile | Sidebar collapses to a bottom tab bar under 768px; 44px tap targets |

---

## One-time setup (do this once)

### 1. Create the database
1. Open your project: <https://supabase.com/dashboard/project/wtmsukjnuqsprtvfytin>
2. Left sidebar → **SQL Editor** → **New query**.
3. Open [`supabase/schema.sql`](supabase/schema.sql), copy the whole file, paste, click **Run**.
   You should see "Success. No rows returned." This creates all six tables, security
   rules, the auto-profile trigger, and turns on realtime.

### 2. Create your login
1. Left sidebar → **Authentication** → **Users** → **Add user** → **Create new user**.
2. Email `elihassan16@gmail.com`, set a password, and **check "Auto Confirm User"**.
3. (Optional) For each teammate, repeat with their email — they'll be `member`s automatically.

> Your email is hard-coded as the **admin** in the SQL. Everyone else is a `member`.
> To promote someone later: Supabase → **Table Editor** → `users` → set their `role` to `admin`.

### 3. Environment variables
The two values are already in `.env.local` for local dev. You'll add the same two to
Vercel in the deploy step below:

```
VITE_SUPABASE_URL=https://wtmsukjnuqsprtvfytin.supabase.co
VITE_SUPABASE_ANON_KEY=<your anon key>
```

---

## Run locally (optional — needs Node.js 18+)

> Node isn't installed on this machine. Install it from <https://nodejs.org> (LTS) if
> you want to preview locally. You can skip this entirely and let Vercel build in the cloud.

```bash
npm install
npm run dev      # http://localhost:5173
```

The first time you sign in as admin against empty tables, the app **auto-seeds** your
50 properties, 5 contacts, and 3 leads.

---

## Deploy to Vercel

### A. Push to GitHub
```bash
git remote add origin https://github.com/<you>/goldstone-app.git
git push -u origin main
```
(The repo is already initialized and committed locally.)

### B. Import into Vercel
1. <https://vercel.com/new> → **Import** your `goldstone-app` repo.
2. Framework preset: **Vite** (auto-detected). Build command `npm run build`, output `dist`.
3. **Environment Variables** → add both:
   - `VITE_SUPABASE_URL` = `https://wtmsukjnuqsprtvfytin.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = `<your anon key>`
4. **Deploy**. You'll get a URL like `https://goldstone-app.vercel.app`.

### C. Tell Supabase about the live URL
Supabase → **Authentication** → **URL Configuration** → set **Site URL** to your Vercel
URL (and add it under **Redirect URLs**). This keeps auth links valid in production.

---

## Install on iPhone (PWA)
1. Open the Vercel URL in **Safari**.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Launch "Goldstone" from the home screen — it opens full-screen, no Safari chrome,
   gold status bar.

---

## How the data layer works
- `src/data/DataProvider.jsx` loads each table once, hydrates the app's rich nested
  objects from a `data` JSONB column, and exposes the same `setSharedProps` / `setLeads`
  / `setAutomations` API the UI already used — so the original components are untouched.
- Writes diff previous vs. next state and upsert only changed rows; deletes removed ones.
- A Supabase realtime channel reloads any table that changes, so all clients converge.
- The `tasks` table is kept in sync automatically by a Postgres trigger that flattens
  each property's nested task list — a ready-to-query reporting table.

## Project layout
```
index.html                 PWA meta + entry
public/manifest.webmanifest
public/icons/              app icons (192/512/maskable/apple-touch)
src/main.jsx               React root + AuthProvider
src/App.jsx                auth gate: Splash → Login → Shell
src/auth/                  AuthProvider + Login screen
src/data/DataProvider.jsx  Supabase data + realtime
src/supabaseClient.js
src/seed.js                initial 50 properties / contacts / leads
src/GoldstoneApp.jsx       the full app UI (ported from goldstone.jsx)
supabase/schema.sql        run this in the Supabase SQL editor
```
