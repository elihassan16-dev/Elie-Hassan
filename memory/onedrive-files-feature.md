---
name: onedrive-files-feature
description: Planned per-property Files tab backed by full OneDrive/SharePoint browsing (paused, awaiting Azure app IDs)
metadata:
  type: project
---

Next feature to build (paused 2026-06-30, resuming ~2026-07-01): a **Files tab on every property**, next to Contacts, with **full in-app OneDrive/SharePoint browsing** (the user explicitly chose this over simple folder links).

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
