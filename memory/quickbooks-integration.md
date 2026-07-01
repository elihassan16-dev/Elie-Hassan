---
name: quickbooks-integration
description: Requested future feature — sync QuickBooks actuals into a property's Financial Overview (not started)
metadata:
  type: project
---

UPDATE 2026-07-01 (mobile session): Added (1) **Auto-sync** — a per-property toggle (`property.qbAutoSync`, default ON) that re-imports the latest QuickBooks numbers into the Actual columns every time a mapped project's P&L loads, and (2) **smarter address→project matching** — `qbMatchScore` (house number + street-word overlap) replaces the old silent street-substring match; shows ranked "Suggested match" options with a confidence label, stars them in the dropdown, and auto-selects only when score≥0.7. Branch `claude/app-changes-mobile-m7zkyd`.

STATUS 2026-07-01: BUILT, DEPLOYED, CONNECTED. QuickBooks Online, client id `ABZXasjjiSvG3epOMwQQdq3IfQIns0QUAmIIfM8eVKwYtionqi`. Backend live (Vercel serverless: api/quickbooks/{connect,callback,status,disconnect,projects,pnl}); secrets QB_CLIENT_ID/QB_CLIENT_SECRET/SUPABASE_SERVICE_ROLE_KEY set in Vercel; token table `quickbooks_connection` created (supabase/quickbooks.sql). User completed OAuth (connected:true). New per-property **QuickBooks tab** shows the project's live P&L + **Import from QuickBooks** button fills Actual columns; project stored at `property.qbProjectId`.

User records each flip as a QuickBooks **Project** (sub-customer). Their COGS account names map 1:1 to app fields — confirmed from a project screenshot: **Purchase Price, Buying Costs, Rehab Costs, Holding Costs** (under Cost of Goods Sold). Import mapping (`qbBucket` in GoldstoneApp.jsx) matches these by keyword → actualPurchasePrice/actualBuyingCosts/actualRehabCosts/actualHoldingCosts; income→actualSalePrice; interest/commission accounts→interest/actualSellingCosts. AWAITING user's test of the import on a real property (verify P&L loads + numbers land in the right Actual boxes). Example project totaled $308,464.73 COGS (Purchase 275,108 / Buying 4,882.35 / Rehab 25,795.16 / Holding 2,679.22), income $0 (not sold).

Original request 2026-07-01: sync the app with the user's **QuickBooks**, match property addresses to QuickBooks projects, and auto-import **actual numbers** into the Financial Overview "Actual" columns (actualPurchasePrice, actualBuyingCosts, actualRehabCosts, actualSalePrice, interest, selling costs, etc. — see `calcA` in GoldstoneApp.jsx).

Key facts/decisions:
- Feasible only for **QuickBooks Online** (has the Accounting API). QuickBooks Desktop has no clean cloud API → fallback would be CSV export→import.
- Unlike the OneDrive feature (browser-only MSAL), QuickBooks OAuth needs a **client secret + token exchange/refresh that must be server-side** → requires adding **Vercel serverless functions** (`api/`), a first backend for this app. Store QB tokens + property↔QB-project mapping in Supabase; client secret in Vercel env vars.
- Hardest part is **mapping** QB accounts/transactions → the app's actual fields; depends entirely on how the user structures QuickBooks (Projects/sub-customers vs Classes vs Customers vs plain categories).

BLOCKED ON USER INPUT (they dismissed the scoping questions): need (1) QuickBooks Online vs Desktop, and (2) how each property is tracked in QB (project/customer/class/category) — a screenshot of one property's QB setup. They'll also need an Intuit Developer app (client id + secret). Also note they're currently mid-wait on the OneDrive IT admin-consent ([[onedrive-files-feature]]). Related app context: [[goldstone-deployment]].
