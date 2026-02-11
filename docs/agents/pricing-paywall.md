# GutSpy IBS 2.0 Agents Guide
## Category: Pricing, Free vs IBS Plus, Paywall

### Goal
Max installs and activation by keeping the first win free, then monetize only on high intent actions.

### Pricing (pivot launch)
- Monthly: €4.99
- Annual: €29.99 (best value)
Framing: "Save about 50% with annual".

### Offer
Free (forever):
- IBS logging + basic summaries usable from day one

IBS Plus (subscription):
- Patterns, advanced trends, reminders, guided 14-day mode, doctor report export

### Feature matrix
Free:
- Onboarding to first BM log
- Unlimited BM logging (Bristol, urgency, pain, notes)
- Unlimited symptoms
- Optional meal notes (not calories-first)
- Timeline view
- Basic weekly summaries
- Patterns teaser only (no detail)

IBS Plus:
- Patterns with time windows + "seen X times"
- Confidence labels in plain language
- Advanced trends
- Reminders settings and quiet hours
- Guided 14-day mode
- Doctor report export (PDF + CSV)

### Paywall placement rules
Never block:
- Onboarding
- First BM log
- Timeline
- Basic weekly summary

Only show paywall on premium actions:
- View patterns detail
- Export doctor report
- Advanced trends
- Start 14-day mode
- Enable reminders (if premium)

### Adapty setup
- One access level: ibs_plus
- Products: monthly + annual
- Placements: paywall_patterns, paywall_export, paywall_program, paywall_reminders

Use this tier/feature matrix when implementing backend checks (e.g. reminder caps, premium-only reminder types).
