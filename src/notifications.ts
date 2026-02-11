/**
 * Notification / reminder logic for GutSpy IBS 2.0.
 *
 * Two scheduled entry points:
 *  1. processReminders  — runs every 30 min, sends daily nudges via FCM
 *  2. processReengagementNudges — runs once daily, sends 3-day inactivity nudge
 *
 * Relies on Firestore collection `notification_settings/{uid}` for per-user config
 * and `digestion_records` to check whether the user already logged today.
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

// ---------------------------------------------------------------------------
// Types (mirrors the client model)
// ---------------------------------------------------------------------------

interface DeviceToken {
  token: string;
  platform: "ios" | "android";
  updated_at: Timestamp;
}

interface NotificationSettings {
  enabled: boolean;
  tier: "free" | "premium";
  timezone: string;
  quiet_hours_start: string;
  quiet_hours_end: string;
  reminder_times: string[];
  frequency: "daily" | "weekdays" | "custom";
  custom_days?: number[];
  reminder_types: { bm: boolean; symptoms: boolean; meals: boolean };
  last_notified_at: Timestamp | null;
  daily_count: number;
  daily_count_date: string;
  last_reengagement_at?: Timestamp | null;
  device_tokens: DeviceToken[];
  created_at: Timestamp;
  updated_at: Timestamp;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NOTIFICATION_SETTINGS_COLLECTION = "notification_settings";
const DIGESTIONS_COLLECTION = "digestion_records";

const MAX_DAILY: Record<string, number> = { free: 1, premium: 3 };
const INACTIVITY_DAYS = 30;
const REENGAGEMENT_DAYS = 3;
const REENGAGEMENT_COOLDOWN_DAYS = 7;

// ---------------------------------------------------------------------------
// Notification copy pool
// ---------------------------------------------------------------------------

const DAILY_NUDGE_POOL = [
  { title: "Quick check-in", body: "Logged anything today? It takes 10 seconds." },
  { title: "Track your day", body: "A quick log helps spot patterns over time." },
  { title: "How's your gut today?", body: "Tap to log in seconds." },
  { title: "10-second check-in", body: "Your future self will thank you for logging." },
];

const REENGAGEMENT_POOL = [
  { title: "Still tracking?", body: "Even a quick note helps. Log when you're ready." },
  { title: "Your log streak", body: "Pick up where you left off — it only takes a moment." },
];

/**
 * Pick a random notification copy from the pool.
 * @param {Array<{title: string, body: string}>} pool Available messages
 * @return {{title: string, body: string}} A randomly selected copy entry
 */
function pickCopy(pool: { title: string; body: string }[]): { title: string; body: string } {
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx];
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/**
 * Convert "HH:mm" to minutes since midnight.
 * @param {string} timeStr Time string in "HH:mm" format
 * @return {number} Minutes since midnight
 */
function toMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Check if a given local time (minutes) falls within quiet hours.
 * Handles ranges that span midnight (e.g. 22:00–08:00).
 * @param {number} currentMinutes Current local time in minutes since midnight
 * @param {string} quietStart Quiet hours start in "HH:mm"
 * @param {string} quietEnd Quiet hours end in "HH:mm"
 * @return {boolean} True if current time is within quiet hours
 */
function isInQuietHours(currentMinutes: number, quietStart: string, quietEnd: string): boolean {
  const start = toMinutes(quietStart);
  const end = toMinutes(quietEnd);
  if (start <= end) {
    return currentMinutes >= start && currentMinutes < end;
  }
  // Spans midnight
  return currentMinutes >= start || currentMinutes < end;
}

/**
 * Get current date/time in a specific IANA timezone.
 * @param {string} tz IANA timezone string (e.g. "Europe/Lisbon")
 * @return {{localTime: string, localDate: string, dayOfWeek: number}}
 *   localTime in "HH:mm", localDate in "YYYY-MM-DD", dayOfWeek 0=Sun
 */
function nowInTimezone(tz: string): { localTime: string; localDate: string; dayOfWeek: number } {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  const localTime = new Intl.DateTimeFormat("en-GB", options).format(now);
  const dateOptions: Intl.DateTimeFormatOptions = {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  };
  const parts = new Intl.DateTimeFormat("en-CA", dateOptions).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const localDate = `${year}-${month}-${day}`;
  // getDay() in UTC — but we need local day; derive from the local date string
  const localDow = new Date(`${localDate}T12:00:00`).getDay(); // 0=Sun
  return { localTime, localDate, dayOfWeek: localDow };
}

/**
 * Check if the current 30-min window covers any of the user's reminder times.
 * Window: [now - 15min, now + 15min].
 * @param {number} currentMinutes Current local time in minutes since midnight
 * @param {string[]} reminderTimes Array of "HH:mm" reminder time strings
 * @return {boolean} True if any reminder time falls within the current window
 */
function isTimeWindowMatch(currentMinutes: number, reminderTimes: string[]): boolean {
  for (const rt of reminderTimes) {
    const rtMinutes = toMinutes(rt);
    const diff = Math.abs(currentMinutes - rtMinutes);
    // Handle midnight wrap: e.g. current=5min, reminder=1435 (23:55)
    const wrappedDiff = Math.min(diff, 1440 - diff);
    if (wrappedDiff <= 15) return true;
  }
  return false;
}

/**
 * Get the start-of-day timestamp in user's timezone for Firestore queries.
 * @param {string} tz IANA timezone string
 * @return {Date} UTC Date representing midnight in the user's local timezone
 */
function getStartOfDayInTz(tz: string): Date {
  const { localDate } = nowInTimezone(tz);
  // Create a Date at midnight in the user's local timezone
  // Using the Intl approach: midnight local = localDate + T00:00:00
  // We need to convert this local midnight to UTC for Firestore comparison
  const localMidnight = new Date(`${localDate}T00:00:00`);
  // This gives us the date at midnight UTC on that date,
  // so we need to adjust by the timezone offset
  const utcStr = new Date().toLocaleString("en-US", { timeZone: tz });
  const utcNow = new Date();
  const localNow = new Date(utcStr);
  const offsetMs = localNow.getTime() - utcNow.getTime();
  return new Date(localMidnight.getTime() - offsetMs);
}

// ---------------------------------------------------------------------------
// Core: processReminders
// ---------------------------------------------------------------------------

/**
 * Process all users with enabled notifications and send FCM push if conditions are met.
 * Called by Cloud Scheduler every 30 minutes.
 */
export async function processReminders(): Promise<void> {
  const db = getFirestore();
  const messaging = getMessaging();

  // 1. Query all enabled notification settings
  const snapshot = await db
    .collection(NOTIFICATION_SETTINGS_COLLECTION)
    .where("enabled", "==", true)
    .get();

  if (snapshot.empty) {
    console.log("processReminders: no enabled users");
    return;
  }

  console.log(`processReminders: processing ${snapshot.size} enabled users`);

  for (const docSnap of snapshot.docs) {
    const uid = docSnap.id;
    const settings = docSnap.data() as NotificationSettings;

    try {
      await processUserReminder(db, messaging, uid, settings);
    } catch (error) {
      console.error(`processReminders: error for user ${uid}:`, error);
    }
  }

  console.log("processReminders: done");
}

/**
 * Evaluate a single user's reminder conditions and send an FCM push if eligible.
 * Checks quiet hours, day/frequency rules, time window, daily cap, today's logs,
 * and inactivity before sending. Cleans up stale tokens on FCM errors.
 * @param {object} db Firestore instance
 * @param {object} messaging FCM messaging instance
 * @param {string} uid Firebase Auth UID
 * @param {object} settings User's notification settings document
 */
async function processUserReminder(
  db: FirebaseFirestore.Firestore,
  messaging: ReturnType<typeof getMessaging>,
  uid: string,
  settings: NotificationSettings
): Promise<void> {
  // Validate device tokens
  if (!settings.device_tokens || settings.device_tokens.length === 0) {
    return;
  }

  const tz = settings.timezone || "UTC";
  const { localTime, localDate, dayOfWeek } = nowInTimezone(tz);
  const currentMinutes = toMinutes(localTime);

  // a. Quiet hours check
  if (isInQuietHours(currentMinutes, settings.quiet_hours_start, settings.quiet_hours_end)) {
    return;
  }

  // b. Day check (weekdays, custom)
  if (settings.frequency === "weekdays" && (dayOfWeek === 0 || dayOfWeek === 6)) {
    return;
  }
  if (settings.frequency === "custom" && settings.custom_days) {
    if (!settings.custom_days.includes(dayOfWeek)) {
      return;
    }
  }

  // c. Time window check
  if (!isTimeWindowMatch(currentMinutes, settings.reminder_times)) {
    return;
  }

  // d. Daily cap check
  const maxDaily = MAX_DAILY[settings.tier] ?? 1;
  if (settings.daily_count_date === localDate && settings.daily_count >= maxDaily) {
    return;
  }

  // e. Log check — has user logged a BM today?
  const startOfDay = getStartOfDayInTz(tz);
  const todayLogsSnap = await db
    .collection(DIGESTIONS_COLLECTION)
    .where("userID", "==", uid)
    .where("created_at", ">=", Timestamp.fromDate(startOfDay))
    .limit(1)
    .get();

  if (!todayLogsSnap.empty) {
    // User already logged today — skip
    return;
  }

  // f. Inactivity check (30 days)
  const lastLogSnap = await db
    .collection(DIGESTIONS_COLLECTION)
    .where("userID", "==", uid)
    .orderBy("created_at", "desc")
    .limit(1)
    .get();

  if (!lastLogSnap.empty) {
    const lastLogTime = (lastLogSnap.docs[0].data().created_at as Timestamp).toDate();
    const daysSinceLastLog = (Date.now() - lastLogTime.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceLastLog > INACTIVITY_DAYS) {
      return;
    }
  }

  // g. Send notification
  const copy = pickCopy(DAILY_NUDGE_POOL);
  const tokens = settings.device_tokens.map((dt) => dt.token);

  const response = await messaging.sendEachForMulticast({
    tokens,
    notification: {
      title: copy.title,
      body: copy.body,
    },
    data: {
      type: "daily_reminder",
      tier: settings.tier,
      reminder_type: "bm",
    },
    apns: {
      payload: {
        aps: {
          sound: "default",
          badge: 1,
        },
      },
    },
    android: {
      priority: "high",
      notification: {
        channelId: "reminders",
        priority: "high",
      },
    },
  });

  console.log(
    `processReminders: sent to ${uid}, success=${response.successCount}, failure=${response.failureCount}`
  );

  // Log FCM errors so we can diagnose delivery failures
  response.responses.forEach((resp, idx) => {
    if (resp.error) {
      console.error(`processReminders: FCM error for ${uid} token[${idx}]:`, {
        code: resp.error.code,
        message: resp.error.message,
      });
    }
  });

  // i. Token cleanup — remove invalid tokens (e.g. APNs token stored as FCM, or stale)
  const invalidTokens: string[] = [];
  response.responses.forEach((resp, idx) => {
    if (resp.error) {
      const code = resp.error.code;
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token" ||
        code === "messaging/invalid-argument"
      ) {
        invalidTokens.push(tokens[idx]);
      }
    }
  });

  if (invalidTokens.length > 0) {
    const cleanedTokens = settings.device_tokens.filter((dt) => !invalidTokens.includes(dt.token));
    await db.collection(NOTIFICATION_SETTINGS_COLLECTION).doc(uid).update({
      device_tokens: cleanedTokens,
      updated_at: Timestamp.now(),
    });
    console.log(`processReminders: cleaned ${invalidTokens.length} stale tokens for ${uid}`);
  }

  // h. Update tracking only if at least one send succeeded (so we don't mark as sent when user got nothing)
  if (response.successCount === 0) {
    return;
  }
  const newDailyCount = settings.daily_count_date === localDate ? settings.daily_count + 1 : 1;
  await db.collection(NOTIFICATION_SETTINGS_COLLECTION).doc(uid).update({
    last_notified_at: Timestamp.now(),
    daily_count: newDailyCount,
    daily_count_date: localDate,
    updated_at: Timestamp.now(),
  });
}

// ---------------------------------------------------------------------------
// Core: processReengagementNudges
// ---------------------------------------------------------------------------

/**
 * Send a re-engagement nudge for free users who haven't logged in ~3 days.
 * Called by Cloud Scheduler once daily at 12:00 UTC.
 */
export async function processReengagementNudges(): Promise<void> {
  const db = getFirestore();
  const messaging = getMessaging();

  // Query free users with enabled notifications
  const snapshot = await db
    .collection(NOTIFICATION_SETTINGS_COLLECTION)
    .where("enabled", "==", true)
    .where("tier", "==", "free")
    .get();

  if (snapshot.empty) {
    console.log("processReengagementNudges: no eligible users");
    return;
  }

  console.log(`processReengagementNudges: checking ${snapshot.size} free users`);

  const now = Date.now();

  for (const docSnap of snapshot.docs) {
    const uid = docSnap.id;
    const settings = docSnap.data() as NotificationSettings;

    try {
      // Skip if no device tokens
      if (!settings.device_tokens || settings.device_tokens.length === 0) continue;

      // Skip if recently sent re-engagement (cooldown)
      if (settings.last_reengagement_at) {
        const lastReengagement = settings.last_reengagement_at.toDate();
        const daysSince = (now - lastReengagement.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince < REENGAGEMENT_COOLDOWN_DAYS) continue;
      }

      // Check quiet hours
      const tz = settings.timezone || "UTC";
      const { localTime } = nowInTimezone(tz);
      const currentMinutes = toMinutes(localTime);
      if (isInQuietHours(currentMinutes, settings.quiet_hours_start, settings.quiet_hours_end)) {
        continue;
      }

      // Check last log — should be 3–4 days ago
      const lastLogSnap = await db
        .collection(DIGESTIONS_COLLECTION)
        .where("userID", "==", uid)
        .orderBy("created_at", "desc")
        .limit(1)
        .get();

      if (lastLogSnap.empty) continue; // Never logged — don't nudge

      const lastLogTime = (lastLogSnap.docs[0].data().created_at as Timestamp).toDate();
      const daysSinceLastLog = (now - lastLogTime.getTime()) / (1000 * 60 * 60 * 24);

      if (daysSinceLastLog < REENGAGEMENT_DAYS || daysSinceLastLog > REENGAGEMENT_DAYS + 1) {
        continue; // Not in the 3–4 day window
      }

      // Also skip if inactive for more than 30 days
      if (daysSinceLastLog > INACTIVITY_DAYS) continue;

      // Send re-engagement push
      const copy = pickCopy(REENGAGEMENT_POOL);
      const tokens = settings.device_tokens.map((dt) => dt.token);

      const response = await messaging.sendEachForMulticast({
        tokens,
        notification: {
          title: copy.title,
          body: copy.body,
        },
        data: {
          type: "reengagement",
          tier: "free",
          reminder_type: "bm",
        },
        apns: {
          payload: {
            aps: {
              sound: "default",
            },
          },
        },
        android: {
          priority: "normal",
          notification: {
            channelId: "reminders",
          },
        },
      });

      console.log(`processReengagementNudges: sent to ${uid}, success=${response.successCount}`);

      // Update tracking
      await db.collection(NOTIFICATION_SETTINGS_COLLECTION).doc(uid).update({
        last_reengagement_at: Timestamp.now(),
        updated_at: Timestamp.now(),
      });

      // Token cleanup
      const invalidTokens: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (resp.error) {
          const code = resp.error.code;
          if (
            code === "messaging/registration-token-not-registered" ||
            code === "messaging/invalid-registration-token"
          ) {
            invalidTokens.push(tokens[idx]);
          }
        }
      });

      if (invalidTokens.length > 0) {
        const cleanedTokens = settings.device_tokens.filter(
          (dt) => !invalidTokens.includes(dt.token)
        );
        await db.collection(NOTIFICATION_SETTINGS_COLLECTION).doc(uid).update({
          device_tokens: cleanedTokens,
        });
      }
    } catch (error) {
      console.error(`processReengagementNudges: error for user ${uid}:`, error);
    }
  }

  console.log("processReengagementNudges: done");
}
