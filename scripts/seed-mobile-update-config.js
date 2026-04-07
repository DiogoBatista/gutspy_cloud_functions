/* eslint-disable no-console, @typescript-eslint/no-var-requires */
const admin = require("firebase-admin");

/**
 * Reads a required environment variable.
 * @param {string} name
 * @return {string}
 */
function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

/**
 * Seeds Firestore app update configuration used by mobile clients.
 * Creates or merges app_config/mobile_update using environment-driven values.
 * @return {Promise<void>}
 */
async function run() {
  const projectId = getRequiredEnv("FIREBASE_PROJECT_ID");
  const latestVersion = process.env.LATEST_VERSION || "2.0.3";
  const minPromptIntervalHours = Number.parseInt(process.env.MIN_PROMPT_INTERVAL_HOURS || "24", 10);
  const iosStoreUrl = process.env.IOS_STORE_URL || "https://apps.apple.com/...";
  const androidStoreUrl =
    process.env.ANDROID_STORE_URL || "https://play.google.com/store/apps/details?id=com.gutspy.app";
  const enabled = String(process.env.UPDATE_ENABLED || "true").toLowerCase() !== "false";

  admin.initializeApp({ projectId });
  const db = admin.firestore();

  const payload = {
    enabled,
    latest_version: latestVersion,
    min_prompt_interval_hours: Number.isNaN(minPromptIntervalHours) ? 24 : minPromptIntervalHours,
    ios_store_url: iosStoreUrl,
    android_store_url: androidStoreUrl,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_by: "scripts/seed-mobile-update-config",
  };

  await db.collection("app_config").doc("mobile_update").set(payload, { merge: true });

  console.log("Seeded Firestore document app_config/mobile_update");
  console.log(JSON.stringify(payload, null, 2));
}

run().catch((error) => {
  console.error("Failed to seed app_config/mobile_update:", error);
  process.exitCode = 1;
});
