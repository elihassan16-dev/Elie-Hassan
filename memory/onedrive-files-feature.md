---
name: onedrive-files-feature
description: Planned per-property Files tab backed by full OneDrive/SharePoint browsing (paused, awaiting Azure app IDs)
metadata:
  type: project
---

STATUS: BUILT & DEPLOYED 2026-07-01 (bundle live on Vercel). BLOCKED on **Microsoft admin consent** — the tenant "Goldstone Properties NJ" has user-consent disabled, and the user is NOT a Global Admin; their **IT company** manages the tenant. User texted IT (2026-07-01) to grant admin consent for app client `8b1ca3b1-7c66-4a1e-958a-c44df9e4cdff` (perms User.Read + Files.ReadWrite.All). Admin-consent link sent to IT: https://login.microsoftonline.com/377dbf92-fa58-4e25-bd42-f96116751c69/adminconsent?client_id=8b1ca3b1-7c66-4a1e-958a-c44df9e4cdff . Note: user initially added Files.Read.All (read-only) by mistake — must be Files.ReadWrite.All for uploads; confirm this is set before/after IT consents. Once consent lands: user hard-refreshes → property → Files → Connect Microsoft should work; then end-to-end test (browse/open/upload).

NEXT FEATURE REQUESTED (not yet built): **auto-match folders by address** — instead of pasting a share link per property, the user connects ONE parent folder once and each property auto-finds its subfolder by matching the property address to the folder name. Needs the user's OneDrive/SharePoint folder layout (parent folder + naming convention) — screenshot still pending. Plan: store the parent folder's driveId/itemId globally (needs a small Supabase settings table or similar), list its children, fuzzy-match folder name to property.address, cache the matched folder on the property, manual override if wrong. Also clarified to user that it's already inherently 2-way (app reads/writes the real OneDrive folder directly, no copies) — no separate sync needed.

Awaiting the user's real-world end-to-end test (MS sign-in → paste a folder share link on a property → browse/open/upload). Azure app: client `8b1ca3b1-7c66-4a1e-958a-c44df9e4cdff`, tenant `377dbf92-fa58-4e25-bd42-f96116751c69`, baked into `src/onedrive/msal.js` (public IDs, not env vars). SPA redirect URI registered = `https://elie-hassan.vercel.app`. Code: `src/onedrive/{msal.js,useOneDrive.js}` + `FilesTab` in GoldstoneApp.jsx (PTABS includes "Files"). Uses MSAL popup + Graph `/shares` + `/drives/{id}/items/{id}/children` + resumable upload. Per-property link stored at `property.filesShareLink`.

A **Files tab on every property**, next to Contacts, with **full in-app OneDrive/SharePoint browsing** (the user explicitly chose this over simple folder links).

**Design agreed:**
- Microsoft sign-in via MSAL (`@azure/msal-browser`), separate from Supabase auth. Scopes: `User.Read`, `Files.ReadWrite.All`. Single-tenant app (their company tenant).
- Per property, the user pastes that property's OneDrive/SharePoint **folder share link** once (stored on the property, persists through the existing Supabase `setSharedProps` layer, e.g. `property.data.filesShareLink`).
- Files tab resolves the share link via Microsoft Graph `GET /shares/u!{base64url(link)}/driveItem?$expand=children`, lists files, supports open (webUrl) / download (@microsoft.graph.downloadUrl) / upload (PUT to the folder's drive+item). Subfolder navigation via item ids on the same driveId.
- Their files live in **SharePoint / OneDrive for Business** (path "Luxury Pro Builders\Goldstone Properties - Shared Files - Documents"), not personal OneDrive — share-link + Graph approach handles both.

**BLOCKER — waiting on the user** to complete a free Azure app registration (portal.azure.com → App registrations → New registration; SPA redirect URI = `https://elie-hassan.vercel.app`; delegated Graph perms User.Read + Files.ReadWrite.All; grant admin consent) and send back:
- Application (client) ID → will become Vercel env var `VITE_MS_CLIENT_ID`
- Directory (tenant) ID → `VITE_MS_TENANT` (single-tenant authority)

Open question: user may not have rights to register apps in their M365 tenant (asked whether they're the admin — unanswered).

**When resuming:** get the two IDs, `npm install @azure/msal-browser`, build `src/onedrive/msal.js` + `useOneDrive` hook + a `FilesTab` component wired into PropDetail's tab bar (next to Contacts), set the env vars locally + in Vercel, deploy, then test end-to-end (sign in → paste a folder link on one property → browse/open/upload). See [[goldstone-deployment]].
