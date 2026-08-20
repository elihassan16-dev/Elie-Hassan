# Goldstone Properties — working notes for Claude

Production real-estate PWA for Elie Hassan (non-technical; voice-dictated messages, sends screenshots). React+Vite+Supabase, live at gpflips.com, auto-deploys from `main` on Vercel. Team: Elie (admin), Moshe, Esti (Estie Ungar, bookkeeper); contractors have a separate portal and must NEVER see admin texting/leads/financials.

## How to ship (every change)
1. Side branch from origin/main: `git checkout -b claude/<name> origin/main`
2. Edit → `npx vite build` (must show "✓ built")
3. Commit → push → PR via GitHub MCP → squash-merge immediately
4. `git fetch origin main && git checkout claude/app-changes-continuation-ocrkls && git rebase origin/main && git push --force-with-lease` then delete the side branch.
- UI redesigns: show an HTML mockup screenshot (playwright-core, executablePath /opt/pw-browsers/chromium, deviceScaleFactor 2 → SendUserFile display:render) and get approval BEFORE building.
- Never put secrets in chat/code — Vercel env vars only. No model ids in commits/PRs.

## Key architecture
- `src/GoldstoneApp.jsx` (~15k lines): almost everything. `src/sms.jsx`: texting store (useSmsTexting, SmsThreadPane/Popup, CallTextCards). `api/jivetel/*`: send/webhook/calls (per-person tokens; JIVETEL_NUMBERS name→number; extensions 101 Elie /102 Moshe /103 Esti). `lib/showings.js`: ShowingTime multi-calendar feeds + 5-min watcher (new-showing alerts + follow-up reminders). `lib/jivetel.js`: identifyPhone/whoLabel (names+roles for notifications). `lib/notify.js`: notifyFanout (recipientsFirst, toTeam, pushOnly).
- Showings page: By property / Hot leads / 👤 By agent (AgentsCrmView = CRM: chase chips, activity log + always-open SmsThreadPane column on desktop, 🤖 reply classifier → status suggestions, ☑ Select mass-text, 📣 Campaigns with campaign_sent dedupe log, 📅 follow-ups in app_settings id "followups", not-interested/badnum hidden).
- Messages page: Team / Texts / All views (texts = SMS threads, tagged agent/buyer via whoMap, 📅 follow-up per row).
- Financials: private-lender draws (drawRate: loan rate → funder default → 15%; hasRate treats 0 as real), held funder money (heldFunderId adjustments auto-shrink on new fundings), construction bridges (linkKind "bridge"), payback chips modal, auto "Reconcile line of credit" task to Esti on new fundings (task.locInfo popup).

## Standing rules
- Preview-before-build for UI; production hotfixes same side-branch flow.
- EVERY design/UI change must pass the `.claude/skills/apple-design` review checklist (iOS 26 HIG / Liquid Glass) before shipping — Elie's rule 8/20/26. Key web translations: glass (backdrop-filter) ONLY in chrome (tab bar, top-bar capsule, popup sheets) never on content cards; chrome monochrome with ONE gold accent; segmented capsules for tabs/toggles (SEG_WRAP/segTab/TOGGLE_CHIP/CAPS_ROW in GoldstoneApp.jsx); ≥44pt touch targets (coarse-pointer halo in index.css); no text under ~10px; textSub/textTert contrast floors in theme.js; honor prefers-reduced-transparency + prefers-reduced-motion (blocks in index.css). Load the skill when reviewing.
- Chat-bubble convention (ALL messaging: SMS panes/popups in sms.jsx, team/office/task chats, contractor portal, AI chats) — Elie approved 8/20/26: bubbles radius 18 w/ hairline borders; name+time (tiny, first name) ONLY over other people's bubbles, never your own; own bubbles get gray "time · Delivered/Read by …" underneath (never blue ✓✓); reply = small ghost ↩ circle beside the bubble, not a labeled button; contractor threads keep gold outline + EXTERNAL badge.
- Do NOT cancel Quo subscription decision = Elie's alone. PR #502 preview shipped (CRM). Tasks "By property" third view previewed but NOT approved/built.
- Sort/behavior decisions Elie made are in git history — read recent commit messages for rationale.

## Recently shipped (context, no open next task)
📞 Phone popup DONE (PR #728): green 📞 top-bar icon + missed badge, dial pad w/ Jivetel desk call + send-to-cell, named call history for all office lines w/ All/Mine/Moshe/Esti tabs, person card — all in the iOS design language. App-wide iOS redesign complete (dashboard untouched by request); contractor portal redesigned (PR #727); preview harnesses: appdemo.html (admin) + ctrdemo.html (contractor portal) via vite.appdemo.config.js.
