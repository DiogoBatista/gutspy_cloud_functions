# GutSpy Cloud Functions – AI agent context

## Project

Firebase Cloud Functions (TypeScript) for **GutSpy IBS**. Handles:

- **Notifications:** FCM push reminders and re-engagement nudges. Entry: `src/notifications.ts`. Scheduled: `processReminders` (every 30 min), `processReengagementNudges` (daily). Uses Firestore `notification_settings/{uid}` and `digestion_records` to decide when to send.
- Other backend logic (digestion, user, etc.) is wired from `src/index.ts`.

---

## Always apply (positioning, reminders, tier)

### Positioning (notification copy tone)
- **No guilt.** No diagnosis language. No exclamation marks in body text.
- Short, neutral, supportive. Example titles: "Quick check-in", "Track your day", "10-second check-in". Example bodies: "Logged anything today? It takes 10 seconds.", "A quick log helps spot patterns over time."

### Reminders: free vs premium
- **Free:** Default OFF until permission granted. After 3rd BM log: pre-permission prompt. Reminder time fixed 20:00 local. Quiet hours fixed 22:00–08:00. Daily only, BM only. Max 1 notification/day.
- **Premium (IBS Plus):** OFF until user enables in Settings. 1–3 custom reminder times. Configurable quiet hours. Frequency: daily, weekdays, or custom days. Reminder types: BM, symptoms, meals. Max 3 notifications/day.
- **Shared:** Re-engagement nudge once after 3 days inactive. Auto-disable after 30 days inactive.

### Quiet hours logic
- Can span midnight. If start <= end: quiet when now >= start AND now < end. If start > end: quiet when now >= start OR now < end. If a reminder time falls in quiet hours, skip it.

### Firestore: notification_settings/{uid}
- enabled, tier ("free" | "premium"), timezone (IANA), quiet_hours_start/end ("HH:mm"), reminder_times[], frequency ("daily" | "weekdays" | "custom"), custom_days[] (0=Sun..6=Sat), reminder_types: { bm, symptoms, meals }, device_tokens[], last_notified_at, daily_count, daily_count_date ("YYYY-MM-DD"), last_reengagement_at.

### Scheduler design (processReminders)
- Every 30 min: query enabled users, convert UTC to user timezone, skip if quiet hours, skip if day not allowed (premium custom days), skip if time not near a reminder time (±15 min), skip if daily cap reached, skip if BM logged today, skip if inactive 30+ days. Send FCM, update last_notified_at and daily_count. Clean stale tokens on FCM errors.

### Analytics events (for client)
- notif_perm_prompted, notif_perm_granted, notif_perm_denied, reminder_enabled, reminder_disabled, reminder_settings_changed, reminder_opened, bm_log_created (source=notification).

---

## Full agent guides

Detailed guidance: **docs/agents/**

- `positioning-guardrails.md` – IBS-only pivot, copy tone, words to avoid
- `reminders-notifications.md` – Full schema, Cloud Scheduler design, copy pool, QA
- `pricing-paywall.md` – Tier/feature matrix for any backend checks (optional)
