---
name: task-automations
description: Task Center now has no auto-generated checklists; tasks come from manual entry or Settings→Automations rules
metadata:
  type: project
---

UPDATE 2026-07-01: Reworked the Task Center per user request.

- **Removed auto status checklists.** `DEFAULT_CHECKLISTS` is no longer used (definition left in place, unused). Tasks no longer appear automatically when a property's status changes. The per-property **Tasks tab** is now a simple manual list (add / assign to a team member / set status / delete); automation-created tasks show there too (badged "auto"). Task Center `allTasks` only collects real saved tasks (text non-empty, not deleted). Task handlers (`updateTaskStatus`, `deleteTask`, `TaskRow`) now key by task `id`, not cat/text.

- **Automations moved to Settings.** The old "⚙ Automations" tab was removed from the Task Center (its dead block still exists behind `showAutomations` which is now always false — safe to delete later). New `AutomationsPanel` lives in the **Settings modal** (⚙ gear in top bar), which is now a two-tab modal: **Archived Properties** | **Automations**.

- **Automations actually apply now** (previously they were stored but never ran). Effect in `GoldstoneShell`: when a non-archived property's status === a rule's `trigger` and the rule id isn't in `property.autoApplied`, the rule's tasks are appended (each tagged `autoId`, cat `Automation`) and the rule id added to `autoApplied`. Applied once per property per rule; creating a rule backfills existing properties already in that status. Rule shape: `{id, trigger, tasks:[{text, assignTo, category}]}` (Supabase `automations` table via DataProvider).

Related: [[goldstone-deployment]], property archive feature (Settings→Archived Properties, 60-day purge).
