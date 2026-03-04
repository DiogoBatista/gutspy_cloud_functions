# GutSpy IBS 2.0 Agents Guide
## Category: Reminders and Notifications

### Goal
Increase logging consistency with respectful notifications that always respect quiet hours.

### Approach
Push notifications are sent server-side via Firebase Cloud Functions + FCM.
The app handles:
- Permission prompts
- Token registration
- Notification taps routing (deep link to Log Bowel Movement (BM))

Server sends a push only if the user has not logged a Bowel Movement (BM) today.

### Free vs Premium
Free:
- Default state: OFF until permission granted
- Activation: pre-permission prompt after 3rd Bowel Movement (BM) log
- Reminder time: fixed 20:00 local
- Quiet hours: fixed 22:00 to 08:00
- Frequency: daily
- Reminder types: Bowel Movement (BM) only
- Max notifications per day: 1

Premium (IBS Plus):
- Default state: OFF until user enables in Settings
- Reminder times: 1 to 3 custom times
- Quiet hours: configurable start and end
- Frequency: daily, weekdays only, or custom days
- Reminder types: Bowel Movement (BM), symptoms, meals toggles
- Max notifications per day: 3

Shared:
- Re-engagement nudge: once after 3 days inactive
- Auto-disable after 30 days of inactivity

### Permission prompt timing
Never during onboarding.
After the user's 3rd Bowel Movement (BM) log, show a pre-permission modal:
- "Want gentle reminders? We nudge you once a day if you have not logged. No spam."
Buttons:
- Enable reminders
- Not now
If user taps Not now, do not auto-ask again. Settings always available.

### Quiet hours logic
Quiet hours can span midnight.
- If start <= end: quiet when now >= start AND now < end
- If start > end: quiet when now >= start OR now < end

If a reminder time falls in quiet hours, skip it. Next scheduler tick re-evaluates.

### Cloud Functions design
Cloud Scheduler every 30 minutes:
- Query enabled users
- Convert UTC time to user timezone
- Skip if quiet hours
- Skip if day not allowed (premium custom days)
- Skip if time not near a reminder time (+/- 15 min)
- Skip if daily cap reached
- Skip if Bowel Movement (BM) logged today
- Skip if inactive 30+ days
- Send FCM push
- Update last_notified_at and daily_count
- Clean stale device tokens on FCM errors

### Firestore schema
Collection: notification_settings/{uid}
Fields:
- enabled: boolean
- tier: "free" or "premium"
- timezone: IANA string
- quiet_hours_start: "HH:mm"
- quiet_hours_end: "HH:mm"
- reminder_times: string[]
- frequency: "daily" | "weekdays" | "custom"
- custom_days: number[] (0=Sun..6=Sat)
- reminder_types: { bm: boolean, symptoms: boolean, meals: boolean }
- device_tokens: [{ token, platform, updated_at }]
- last_notified_at: timestamp
- daily_count: number
- daily_count_date: "YYYY-MM-DD"
- last_reengagement_at: timestamp

### Notification copy rules
- No guilt.
- No diagnosis language.
- No exclamation marks in body text.
- Short, neutral, supportive.

Example titles:
- Quick check-in
- Track your day
- 10-second check-in

Example bodies:
- Logged anything today? It takes 10 seconds.
- A quick log helps spot patterns over time.
- Tap to log in seconds.

### Analytics events
- notif_perm_prompted
- notif_perm_granted
- notif_perm_denied
- reminder_enabled
- reminder_disabled
- reminder_settings_changed
- reminder_opened
- bm_log_created (source=notification)

### Output formats this category should produce
- Implementation plan prompt for Cursor
- Notification copy variants
- QA checklist for quiet hours and caps
