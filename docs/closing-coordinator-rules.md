# AI Closing Coordinator — rule list (DRAFT for Elie to correct)

Every rule is the same five things:

| | |
|---|---|
| **When** | what makes the agent wake up |
| **Only if** | the guard, so it never fires on the wrong deal |
| **Email to** | who gets it (the agent writes from closings@goldstonepropertiesnj.com) |
| **What it says** | the gist — the agent writes the real wording in our voice |
| **Done when** | what proves it worked, so the agent stops chasing |

Elie: go through these and tell me **wrong / right / missing**. Change the day counts —
those are guesses. Anything you delete, delete. Rules 1–16 are us **selling** a flip,
17–18 are us **buying**.

---

## Selling a flip

**1. Contract signed → tell our attorney**
- **When:** property status moves to Attorney Review, or a fully-signed contract lands in the Closings mailbox
- **Only if:** both sides signed
- **Email to:** our attorney · cc Elie
- **Says:** signed contract attached, confirm the review start and the 3-business-day end date, flag anything in the buyer's rider we should push back on
- **Done when:** attorney replies with the review-end date, saved on the property

**2. Attorney review dragging**
- **When:** 2 business days in Attorney Review, no conclusion letter
- **Only if:** still in Attorney Review
- **Email to:** buyer's attorney · cc our attorney
- **Says:** checking in — anything outstanding to conclude review?
- **Done when:** conclusion letter arrives, status moves to In Closing
- *(the urgent team task for this already exists in the app — the email is the new part)*

**3. Deposit in escrow**
- **When:** attorney review concluded
- **Only if:** we have no escrow receipt
- **Email to:** buyer's attorney
- **Says:** confirm the full deposit is in escrow, send the receipt
- **Done when:** escrow receipt on file

**4. Book the inspection**
- **When:** attorney review concluded
- **Only if:** no inspection date on the property
- **Email to:** buyer's agent · cc buyer's attorney
- **Says:** inspection period runs to <date>, send dates, house will be accessible with utilities on
- **Done when:** inspection date on the property calendar

**5. Inspection response deadline**
- **When:** 2 days before the response deadline, nothing received
- **Only if:** the inspection happened
- **Email to:** buyer's attorney
- **Says:** response is due <date> — if there are requests, send them now
- **Done when:** response letter arrives, or the deadline passes clean

**6. Mortgage application in**
- **When:** 5 days after attorney review concluded
- **Only if:** buyer is financing (skip cash deals)
- **Email to:** buyer's attorney · cc buyer's agent
- **Says:** confirm the application is in, send the lender and loan-officer contact
- **Done when:** loan officer saved on the property

**7. Appraisal access**
- **When:** we have the loan officer and there's no appraisal date
- **Only if:** financed deal
- **Email to:** loan officer · cc buyer's agent
- **Says:** ready for the appraisal, here's access — plus the renovation list and our comps
- **Done when:** appraisal date set

**8. Appraisal result**
- **When:** 5 days after the appraisal, no result
- **Only if:** financed deal
- **Email to:** loan officer
- **Says:** did it come in at value?
- **Done when:** at or above price confirmed. Below price = urgent push to Elie, no auto-reply

**9. Mortgage commitment deadline**
- **When:** 3 days before the commitment date, no letter
- **Only if:** financed deal
- **Email to:** loan officer + buyer's attorney
- **Says:** commitment due <date> — clear to issue? any open conditions?
- **Done when:** commitment letter on file

**10. Title**
- **When:** attorney review concluded
- **Only if:** no title company on the property
- **Email to:** buyer's attorney
- **Says:** who's doing title — send the contact so we clear anything early
- **Done when:** title company saved. When the commitment arrives, exceptions go to our attorney with "what do we have to clear?"

**11. Smoke / CO certificate (NJ)**
- **When:** 30 days before closing
- **Only if:** no fire certificate on file
- **Email to:** Moshe (internal) + the town if they take email
- **Says:** book the smoke/CO inspection for <address>, closing is <date>
- **Done when:** certificate PDF filed on the property

**12. Final water / sewer reading**
- **When:** 10 days before closing
- **Only if:** not requested yet
- **Email to:** town water & sewer · cc our attorney
- **Says:** final reading for a <date> closing
- **Done when:** final bill received and sent to the attorney

**13. Payoff statements**
- **When:** 14 days before closing
- **Only if:** the deal has hard money or private lenders
- **Email to:** each lender · cc Esti
- **Says:** payoff good through <closing date>, plus wire instructions
- **Done when:** a payoff letter for every lender on the deal
- *(the app already builds our own payoff statements — this is us collecting theirs)*

**14. Settlement statement**
- **When:** 3 days before closing
- **Only if:** no draft statement received
- **Email to:** our attorney · cc buyer's attorney
- **Says:** send the draft settlement statement so we can check the numbers and our proceeds wire
- **Done when:** statement received and checked against the app's Cash-Out Analysis — a gap over $2,000 pushes Elie

**15. Walkthrough + closing confirmation**
- **When:** 5 days before closing
- **Only if:** no walkthrough date
- **Email to:** buyer's agent · cc both attorneys
- **Says:** confirm date, time and place, book the final walkthrough, who's bringing keys
- **Done when:** walkthrough and closing time confirmed

**16. After closing**
- **When:** status moves to Sold
- **Only if:** closing confirmed
- **Email to:** Esti · cc Elie
- **Says:** closed — settlement statement and payoffs attached, book it in QuickBooks, confirm the deed got recorded
- **Done when:** statement filed on the property and Esti confirms it's booked

## Buying

**17. Our contract signed**
- **When:** a purchase contract is signed
- **Only if:** we're the buyer
- **Email to:** our attorney
- **Says:** contract attached — confirm attorney review and send me every deadline as dates
- **Done when:** the deadline list is on the property calendar

**18. Our deposit**
- **When:** attorney review concluded on a purchase
- **Only if:** deposit not sent
- **Email to:** Esti · cc our attorney
- **Says:** deposit of $X due <date>, wire instructions attached
- **Done when:** wire confirmation on file

---

## Still open before any of this can run

- **Send As on closings@** — IT granted access but not Send As, so nobody can send from the
  address yet. Elie reported it 11/11; ticket TK-6917 needs to reopen.
- **office@ doesn't show in Outlook** — IT says they created it (11/10). Elie sees closings@
  only. Probably automapping; same ticket.
- **Nothing auto-sends at the start.** Every rule drafts, Elie taps send. Auto-send gets
  turned on rule by rule, once he's seen each one behave.
