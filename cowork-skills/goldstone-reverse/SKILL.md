---
name: goldstone-reverse
description: Check Elie's MLS reverse-prospecting reports for every Goldstone listing, read each NEW buyer's agent's CELL number from their MLS business card, and add them to that listing's 🎯 Reverse tab in the Goldstone app (one push to Elie when there's something new). Use when Elie says "check reverse prospecting", "get the new agents", "check the MLS for agents", or on the Monday/Thursday 8 AM scheduled run.
---

# Goldstone — reverse-prospecting check (MLS → app)

Goal: for each of our listings, find the buyer's agents whose clients' searches match it
(the MLS "reverse prospecting" report), get each agent's **mobile/cell** number, and send
them to the Goldstone app. **Never text, email or contact any agent.** Elie sends the pitch
himself from the app.

Tools: the **Goldstone** connector (`reverse_listings`, `add_reverse_agents`) and **Chrome**
(Elie's own Chrome, already signed in to his MLS accounts).

## Rules (always)
- **Never type, ask for, or store a password.** If an MLS shows a login page and Chrome
  doesn't fill it in and sign in by itself, or asks for a security / 2-step code: stop
  checking that MLS and tell Elie at the end ("Bright MLS needs you to log in again").
- Read only. Don't click "Email Selected", don't save searches, don't change anything in the MLS.
- If an MLS shows a warning about automated use, a captcha, or a usage limit: stop that MLS
  and tell Elie.
- Open business cards one at a time, at a normal pace.

## Steps
1. Call **`reverse_listings`**. It lists the MLS accounts (name, website, notes) and every
   listing to check: its MLS, MLS #, and the agents already on our list (marked
   "cell ✓" or "NEEDS CELL").
2. For each listing whose MLS is set:
   1. In Chrome, open that MLS website and find the listing (search the MLS # if given,
      otherwise the address).
   2. Open its reverse-prospecting report. The name differs per MLS: "Reverse Prospecting",
      "Reverse Prospect", "Matching Buyers", "Interested Agents", "Prospects", or a tab on
      the listing's detail page. Use the notes saved for that MLS if they say where it is.
   3. For each agent row:
      - Already on our list with **cell ✓** → skip it.
      - New, or on our list as **NEEDS CELL** → open the agent's name or business card. Take
        the number labeled **Mobile / Cell**. That's `cell`. Any Office / Main / Direct /
        unlabeled brokerage number goes in `office_phone`. **If the card shows no mobile,
        leave `cell` empty.** Never put an office number in `cell`.
      - Also note email, office (brokerage), and how many of their buyers/searches matched
        (`buyers`; 1 if not shown).
   4. If you see the listing's MLS #, include it as `mls_number`.
3. Listings whose MLS isn't set: if only ONE MLS is saved, try that MLS by address. Otherwise
   skip and list them for Elie ("set the MLS for these in the app").
4. Call **`add_reverse_agents` ONCE** with every listing you checked, including ones with no
   new agents, so they're marked checked. It sends Elie one push when something is new.
5. Finish with a short summary per listing: new agents, cells found, still missing a cell,
   and any MLS that needs Elie to log in.

## Schedule
Runs every **Monday and Thursday at 8:00 AM** (Cowork scheduled task). Elie's computer must be
on with the Claude app open. If Chrome isn't signed in, report it and stop.
