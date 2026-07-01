---
name: quickbooks-integration
description: Requested future feature — sync QuickBooks actuals into a property's Financial Overview (not started)
metadata:
  type: project
---

Requested 2026-07-01 (not started, deferred): sync the app with the user's **QuickBooks**, match property addresses to QuickBooks projects, and auto-import **actual numbers** into the Financial Overview "Actual" columns (actualPurchasePrice, actualBuyingCosts, actualRehabCosts, actualSalePrice, interest, selling costs, etc. — see `calcA` in GoldstoneApp.jsx).

Key facts/decisions:
- Feasible only for **QuickBooks Online** (has the Accounting API). QuickBooks Desktop has no clean cloud API → fallback would be CSV export→import.
- Unlike the OneDrive feature (browser-only MSAL), QuickBooks OAuth needs a **client secret + token exchange/refresh that must be server-side** → requires adding **Vercel serverless functions** (`api/`), a first backend for this app. Store QB tokens + property↔QB-project mapping in Supabase; client secret in Vercel env vars.
- Hardest part is **mapping** QB accounts/transactions → the app's actual fields; depends entirely on how the user structures QuickBooks (Projects/sub-customers vs Classes vs Customers vs plain categories).

BLOCKED ON USER INPUT (they dismissed the scoping questions): need (1) QuickBooks Online vs Desktop, and (2) how each property is tracked in QB (project/customer/class/category) — a screenshot of one property's QB setup. They'll also need an Intuit Developer app (client id + secret). Also note they're currently mid-wait on the OneDrive IT admin-consent ([[onedrive-files-feature]]). Related app context: [[goldstone-deployment]].
