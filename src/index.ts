/* eslint-disable max-len */
import axios from "axios";
import * as admin from "firebase-admin";
import { getAuth } from "firebase-admin/auth";
import type { DocumentReference } from "firebase-admin/firestore";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { beforeUserCreated } from "firebase-functions/v2/identity";
import { onSchedule, ScheduledEvent } from "firebase-functions/v2/scheduler";
import { onObjectFinalized } from "firebase-functions/v2/storage";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { processReminders, processReengagementNudges } from "./notifications";
import { AIService } from "./services/ai";
import { SlackService } from "./services/slack";
import { generateUserWeeklySummary } from "./user";

admin.initializeApp();

// Get service instances
const db = getFirestore();
const auth = getAuth();

/**
 * Shared: run AI image analysis on a digestion record and update the doc.
 * @param {DocumentReference} docRef Firestore document reference for the digestion record
 * @param {Object} data Record data with userID, filename, and optional analysis
 */
async function runDigestionImageAnalysis(
  docRef: DocumentReference,
  data: { userID: string; filename: string; analysis?: Record<string, unknown> }
): Promise<void> {
  const filePath = `${data.userID}/digestions/${data.filename}`;
  const bucket = admin.storage().bucket();
  const file = bucket.file(filePath);
  const [fileExists] = await file.exists();
  if (!fileExists) {
    await docRef.update({
      status: "failed",
      error_details: { message: "File does not exist" },
    });
    return;
  }
  await docRef.update({ status: "processing" });
  const tempFilePath = path.join(os.tmpdir(), data.filename);
  try {
    await file.download({ destination: tempFilePath });
    const fileBuffer = fs.readFileSync(tempFilePath);
    const base64Encoded = fileBuffer.toString("base64");
    const aiService = AIService.getInstance();
    const resultJson = await aiService.analyzeDigestionImage(base64Encoded);

    console.log("resultJson", resultJson);

    await docRef.update({
      status: "processed",
      processed_at: Timestamp.fromDate(new Date()),
      analysis: {
        ...(data.analysis || {}),
        bristol_scale: resultJson.analysis.bristol_stool_scale.toString(),
        color: resultJson.analysis.color,
        consistency: resultJson.analysis.consistency,
        shape: resultJson.analysis.shape,
        size: resultJson.analysis.size,
        has_blood: resultJson.analysis.presence_of_blood,
        has_mucus: resultJson.analysis.presence_of_mucus,
        source: "ai",
      },
      ai_concerns: resultJson.concerns,
      ai_recommendations: resultJson.recommendations,
      notes: resultJson.summary,
    });
  } catch (error) {
    console.error("Failed to process digestion image:", error);
    await docRef.update({
      status: "failed",
      error_details: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
  } finally {
    try {
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    } catch {
      // ignore cleanup errors
    }
  }
}

/**
 * Run meal image AI for a meal_log (2.0). Updates doc with ai_name and ai_ingredients only; no calories.
 * @param {DocumentReference} mealLogRef Firestore document reference for the meal_log
 * @param {string} userID User ID
 * @param {string} mealLogId Meal log ID
 * @param {string} filename Filename
 */
async function runMealLogImageAnalysis(
  mealLogRef: DocumentReference,
  userID: string,
  mealLogId: string,
  filename: string
): Promise<void> {
  const filePath = `${userID}/meal_logs/${mealLogId}/${filename}`;
  const bucket = admin.storage().bucket();
  const file = bucket.file(filePath);
  const [fileExists] = await file.exists();
  if (!fileExists) {
    await mealLogRef.update({
      status: "failed",
      error_details: { message: "File does not exist" },
    });
    return;
  }
  await mealLogRef.update({ status: "processing" });
  const tempFilePath = path.join(os.tmpdir(), filename);
  try {
    await file.download({ destination: tempFilePath });
    const fileBuffer = fs.readFileSync(tempFilePath);
    const base64Encoded = fileBuffer.toString("base64");
    const aiService = AIService.getInstance();
    const resultJson = await aiService.analyzeMealImage(base64Encoded);
    const aiName = resultJson?.image_recognition?.name ?? "";
    const aiIngredients = resultJson?.ingredient_extraction ?? [];
    await mealLogRef.update({
      status: "processed",
      ai_name: aiName,
      ai_ingredients: aiIngredients,
      processed_at: Timestamp.fromDate(new Date()),
    });
  } catch (error) {
    console.error("Failed to process meal_log image:", error);
    await mealLogRef.update({
      status: "error",
      error_details: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
  } finally {
    try {
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    } catch {
      // ignore
    }
  }
}

// Start writing functions
// https://firebase.google.com/docs/functions/typescript

// Cloud Function to handle object finalization in Firebase Storage
export const fileCreated = onObjectFinalized(async (event) => {
  // Extract the file path and name
  const filePath = event.data.name; // File path in the bucket
  if (!filePath) return console.log("No file path found");

  // Split the filePath to get userID, type and filename (normalize: no leading/trailing slashes)
  const pathSegments = filePath.split("/").filter(Boolean);
  if (pathSegments.length < 3) {
    return console.log("Unexpected file path structure:", filePath);
  }

  // Structure is "userID/type/filename" or "userID/meal_logs/mealLogId/filename"
  const userID = pathSegments[0];
  const type = pathSegments[1];
  const filename = pathSegments[2];

  console.log("userID", userID);
  console.log("type", type);
  console.log("filename", filename);

  // 2.0 meal_logs: path userID/meal_logs/mealLogId/filename — update existing meal_log doc
  if (type === "meal_logs" && pathSegments.length >= 4) {
    const mealLogId = pathSegments[2];
    const mealLogRef = db.collection("meal_logs").doc(mealLogId);
    const mealLogSnap = await mealLogRef.get();
    const mealLogData = mealLogSnap.data();
    if (!mealLogSnap.exists || !mealLogData || mealLogData.userID !== userID) {
      return console.log("meal_logs: doc not found or user mismatch", mealLogId);
    }
    await mealLogRef.update({
      filename: pathSegments[3],
      status: "to_be_processed",
    });
    console.log("meal_logs: attached photo to", mealLogId);
    await runMealLogImageAnalysis(mealLogRef, userID, mealLogId, pathSegments[3]);
    return;
  }

  // Validate type (3-segment paths only below)
  if (pathSegments.length !== 3 || !["meals", "digestions", "profile"].includes(type)) {
    return console.log("Invalid type or path length:", type, pathSegments.length);
  }

  // Determine collection based on type
  let collection = "";

  if (type === "meals") {
    collection = "meal_records";
  } else if (type === "digestions") {
    collection = "digestion_records";
  } else if (type === "profile") {
    collection = "user_profiles";
  }

  if (collection === "") {
    return console.log("Invalid type:", type);
  }

  try {
    if (type === "digestions") {
      // BmItem uploads as recordId_timestamp.jpg for existing log; do not create a new doc.
      if (filename.includes("_")) {
        const candidateRecordId = filename.split("_")[0];
        const existingDoc = await db.collection(collection).doc(candidateRecordId).get();
        const existingData = existingDoc.data();
        const docUserIdField = existingData && (existingData as { userId?: string }).userId;
        const docUserID = existingData && (existingData.userID ?? docUserIdField);
        const belongsToUser = docUserID === userID;
        console.log("Digestion existing-check:", {
          candidateRecordId,
          exists: existingDoc.exists,
          docUserID: docUserID ?? "(none)",
          pathUserID: userID,
          belongsToUser,
        });
        if (existingDoc.exists && existingData && belongsToUser) {
          await existingDoc.ref.update({
            filename,
            status: "to_be_processed",
            analysis: { source: "ai" },
          });
          console.log("Digestion: attached photo to existing record", candidateRecordId);
          // Run AI here so the file is guaranteed to exist (same trigger); app's on-demand call will get cached.
          const mergedData = {
            ...existingData,
            userID,
            filename,
            analysis: { ...(existingData.analysis || {}), source: "ai" as const },
          };

          console.log("mergedData", mergedData);
          await runDigestionImageAnalysis(existingDoc.ref, mergedData);
          return;
        }
      }

      const digestionRecordData = {
        userID: userID,
        filename: filename,
        status: "to_be_processed",
        analysis: {
          source: "ai",
        },
        created_at: Timestamp.fromDate(new Date()),
        type: type,
      };

      console.log("Digestion record data:", digestionRecordData);

      await db.collection(collection).add(digestionRecordData);
      console.log("Digestion record added successfully");
    } else if (type === "meals") {
      console.log("TIMESTAMP: ", Timestamp, Timestamp.fromDate(new Date()));

      // Add meal record
      const mealRecordData = {
        userID: userID,
        filename: filename,
        status: "to_be_processed",
        nutritional_report: null,
        created_at: Timestamp.fromDate(new Date()),
        type: type,
      };

      console.log("Meal record data:", mealRecordData);

      await db.collection(collection).add(mealRecordData);
      console.log("Meal record added successfully");
    } else if (type === "profile") {
      // TODO: Add profile record
    }

    // console.log(`${type} successfully written with ID:`, docRef.id);
  } catch (error) {
    console.error("Error writing document:", error);
  }
});

export const onImageProcessingRecordCreated = onDocumentCreated(
  "/meal_records/{recordId}",
  async (event) => {
    const recordId = event.params.recordId;
    const snapshot = event.data;

    if (!snapshot) {
      console.log("No data associated with the event");
      return;
    }

    const newData = snapshot.data();

    console.log(`New record with ID ${recordId} and data:`, newData);

    // Check if necessary data is available
    if (!newData || !newData.filename || !newData.userID || !newData.type) {
      console.log("Required data missing in the new record");
      return null;
    }

    // Update the status to "processing"
    await snapshot.ref.update({
      status: "processing",
    });

    try {
      const storage = admin.storage();
      const bucket = storage.bucket();
      const type = newData.type;
      const filePath = `${newData.userID}/${type}/${newData.filename}`;

      const file = bucket.file(filePath);
      const [fileExists] = await file.exists();
      if (!fileExists) {
        console.log("File does not exist:", filePath);
        return null;
      }

      // Download the file to a temporary location to process
      const tempFilePath = path.join(os.tmpdir(), newData.filename);
      await file.download({ destination: tempFilePath });
      console.log("File downloaded locally to", tempFilePath);

      // Convert file to base64
      const fileBuffer = fs.readFileSync(tempFilePath);
      const base64Encoded = fileBuffer.toString("base64");
      console.log("File converted to Base64");

      // Use AIService to analyze the image
      const aiService = AIService.getInstance();
      const resultJson = await aiService.analyzeMealImage(base64Encoded);

      await snapshot.ref.update({
        status: "processed",
        nutritional_report: resultJson,
        processed_at: Timestamp.fromDate(new Date()),
      });

      // Send Slack notification with meal name (skip when seed data)
      if (newData.skip_slack !== true) {
        try {
          const slackService = SlackService.getInstance();
          const mealName = resultJson?.image_recognition?.name;
          await slackService.notifyMealCreated(newData.userID, recordId, mealName);
        } catch (error) {
          console.error("Failed to send Slack notification for meal record:", error);
          // Continue with processing even if Slack notification fails
        }
      }

      // Clean up: delete the local file to free up space
      fs.unlinkSync(tempFilePath);

      return null;
    } catch (error) {
      console.error("Failed to fetch or process the file:", error);
      await snapshot.ref.update({
        status: "error",
        error_details: {
          message: error instanceof Error ? error.message : String(error),
          response_preview: error instanceof Error ? error.stack : String(error),
        },
      });
      return null;
    }
  }
);

// Notify Slack when a symptom log is created
export const onSymptomLogCreated = onDocumentCreated(
  "/symptom_logs/{symptomLogId}",
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const data = snapshot.data();
    if (!data?.userID) return;
    if (data.skip_slack === true) return;

    try {
      const slackService = SlackService.getInstance();
      await slackService.notifySymptomCreated(
        data.userID,
        snapshot.ref.id,
        data.symptom_label ?? "Symptom",
        data.severity
      );
    } catch (error) {
      console.error("Failed to send Slack notification for symptom log:", error);
    }
  }
);

// New function to handle digestion record processing
export const onDigestionRecordCreated = onDocumentCreated(
  "/digestion_records/{recordId}",
  async (event) => {
    console.log("onDigestionRecordCreated", event);

    const snapshot = event.data;
    if (!snapshot) {
      console.log("No data associated with the event");
      return;
    }

    const data = snapshot.data();
    const docRef = snapshot.ref;

    console.log("New record data:", data);

    if (!data) {
      console.log("No data associated with the event");
      return;
    }

    // Send Slack notification for all digestion records (skip when seed data)
    if (data.skip_slack !== true) {
      try {
        const slackService = SlackService.getInstance();
        await slackService.notifyDigestionCreated(data.userID, docRef.id, data.analysis.source);
      } catch (error) {
        console.error("Failed to send Slack notification for digestion record:", error);
        // Continue with processing even if Slack notification fails
      }
    }

    const aiService = AIService.getInstance();

    // Process based on the source
    if (data.analysis.source === "manual") {
      // New app sends request_ai_on_create: false to skip auto-AI (on-demand only)
      if (data.request_ai_on_create === false) {
        await docRef.update({ status: "processed" });
        return null;
      }
      try {
        const resultJson = await aiService.analyzeDigestionData(data.analysis);

        // Update record with AI insights (legacy app behavior)
        await docRef.update({
          status: "processed",
          processed_at: Timestamp.fromDate(new Date()),
          ai_concerns: resultJson.concerns,
          ai_recommendations: resultJson.recommendations,
        });
      } catch (error) {
        console.error("Failed to process manual record:", error);
        await docRef.update({
          status: "failed",
          error_details: {
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    } else if (data.filename && data.userID) {
      await runDigestionImageAnalysis(docRef, {
        userID: data.userID,
        filename: data.filename,
        analysis: data.analysis as Record<string, unknown> | undefined,
      });
    }

    return null;
  }
);

/** On-demand AI explain (premium). Called by app when user taps "Explain this log". */
export const requestDigestionAiExplain = onCall({ enforceAppCheck: false }, async (request) => {
  console.log("requestDigestionAiExplain:start", {
    uid: request.auth?.uid ?? null,
    hasAuth: !!request.auth,
    recordId: (request.data as { recordId?: string } | undefined)?.recordId ?? null,
  });

  if (!request.auth) {
    console.warn("requestDigestionAiExplain:unauthenticated");
    throw new HttpsError("unauthenticated", "Must be signed in");
  }
  const { recordId } = request.data as { recordId: string };
  if (!recordId || typeof recordId !== "string") {
    console.warn("requestDigestionAiExplain:invalid-argument", { uid: request.auth.uid, recordId });
    throw new HttpsError("invalid-argument", "recordId is required");
  }

  console.log("requestDigestionAiExplain:fetch-record", { uid: request.auth.uid, recordId });
  const docSnap = await db.collection("digestion_records").doc(recordId).get();
  if (!docSnap.exists) {
    console.warn("requestDigestionAiExplain:record-not-found", { uid: request.auth.uid, recordId });
    throw new HttpsError("not-found", "Record not found");
  }

  const data = docSnap.data();
  if (!data || data.userID !== request.auth.uid) {
    console.warn("requestDigestionAiExplain:permission-denied", {
      uid: request.auth.uid,
      recordId,
      recordUserId: data?.userID ?? null,
    });
    throw new HttpsError("permission-denied", "Not your record");
  }
  if (data.ai_concerns?.length && data.ai_recommendations?.length) {
    console.log("requestDigestionAiExplain:cache-hit", {
      uid: request.auth.uid,
      recordId,
      concernsCount: data.ai_concerns.length,
      recommendationsCount: data.ai_recommendations.length,
    });
    return { cached: true };
  }

  console.log("requestDigestionAiExplain:ai-analysis-start", { uid: request.auth.uid, recordId });
  const aiService = AIService.getInstance();
  const resultJson = await aiService.analyzeDigestionData(data.analysis);

  console.log("requestDigestionAiExplain:ai-analysis-finished", {
    uid: request.auth.uid,
    recordId,
    concernsCount: resultJson.concerns?.length ?? 0,
    recommendationsCount: resultJson.recommendations?.length ?? 0,
  });

  await docSnap.ref.update({
    status: "processed",
    processed_at: Timestamp.fromDate(new Date()),
    ai_concerns: resultJson.concerns,
    ai_recommendations: resultJson.recommendations,
  });

  console.log("requestDigestionAiExplain:success", { uid: request.auth.uid, recordId });
  return { cached: false };
});

/** On-demand image analysis (premium). Called by app when user taps "Scan photo". */
export const requestDigestionImageAnalysis = onCall({ enforceAppCheck: false }, async (request) => {
  console.log("requestDigestionImageAnalysis:start", {
    uid: request.auth?.uid ?? null,
    hasAuth: !!request.auth,
    recordId: (request.data as { recordId?: string } | undefined)?.recordId ?? null,
    filePath: (request.data as { filePath?: string } | undefined)?.filePath ?? null,
  });

  if (!request.auth) {
    console.warn("requestDigestionImageAnalysis:unauthenticated");
    throw new HttpsError("unauthenticated", "Must be signed in");
  }
  const { recordId, filePath } = request.data as { recordId: string; filePath: string };
  if (!recordId || !filePath) {
    console.warn("requestDigestionImageAnalysis:invalid-argument", {
      uid: request.auth.uid,
      recordId,
      filePath,
    });
    throw new HttpsError("invalid-argument", "recordId and filePath are required");
  }

  console.log("requestDigestionImageAnalysis:fetch-record", {
    uid: request.auth.uid,
    recordId,
  });
  const docSnap = await db.collection("digestion_records").doc(recordId).get();
  if (!docSnap.exists) {
    console.warn("requestDigestionImageAnalysis:record-not-found", {
      uid: request.auth.uid,
      recordId,
    });
    throw new HttpsError("not-found", "Record not found");
  }

  const data = docSnap.data();
  if (!data || data.userID !== request.auth.uid) {
    console.warn("requestDigestionImageAnalysis:permission-denied", {
      uid: request.auth.uid,
      recordId,
      recordUserId: data?.userID ?? null,
    });
    throw new HttpsError("permission-denied", "Not your record");
  }
  if (data.ai_concerns?.length && data.ai_recommendations?.length) {
    console.log("requestDigestionImageAnalysis:cache-hit", {
      uid: request.auth.uid,
      recordId,
      concernsCount: data.ai_concerns.length,
      recommendationsCount: data.ai_recommendations.length,
    });
    return { cached: true };
  }

  console.log("requestDigestionImageAnalysis:check-storage-file", {
    uid: request.auth.uid,
    recordId,
    filePath,
  });
  const bucket = admin.storage().bucket();
  const file = bucket.file(filePath);
  const [fileExists] = await file.exists();
  if (!fileExists) {
    // Storage trigger may not have written the file yet; AI will run in fileCreated. Tell app to wait.
    console.log("requestDigestionImageAnalysis:file-missing-processing", {
      uid: request.auth.uid,
      recordId,
      filePath,
    });
    return { processing: true };
  }

  console.log("requestDigestionImageAnalysis:file-found-download-start", {
    uid: request.auth.uid,
    recordId,
    filePath,
  });
  const [buffer] = await file.download();
  const base64Encoded = buffer.toString("base64");

  console.log("requestDigestionImageAnalysis:ai-analysis-start", {
    uid: request.auth.uid,
    recordId,
    filePath,
  });
  const aiService = AIService.getInstance();
  const resultJson = await aiService.analyzeDigestionImage(base64Encoded);

  console.log("requestDigestionImageAnalysis:ai-analysis-finished", {
    uid: request.auth.uid,
    recordId,
    filePath,
    concernsCount: resultJson.concerns?.length ?? 0,
    recommendationsCount: resultJson.recommendations?.length ?? 0,
    source: "ai",
  });

  await docSnap.ref.update({
    status: "processed",
    processed_at: Timestamp.fromDate(new Date()),
    analysis: {
      ...(data.analysis || {}),
      bristol_scale: resultJson.analysis.bristol_stool_scale.toString(),
      color: resultJson.analysis.color,
      consistency: resultJson.analysis.consistency,
      shape: resultJson.analysis.shape,
      size: resultJson.analysis.size,
      has_blood: resultJson.analysis.presence_of_blood,
      has_mucus: resultJson.analysis.presence_of_mucus,
      source: "ai",
    },
    ai_concerns: resultJson.concerns,
    ai_recommendations: resultJson.recommendations,
  });

  console.log("requestDigestionImageAnalysis:success", {
    uid: request.auth.uid,
    recordId,
    filePath,
  });
  return { cached: false };
});

export const generateWeeklySummaries = onSchedule(
  {
    schedule: "0 0 * * 0", // Every Sunday at midnight
    timeZone: "UTC",
    memory: "256MiB", // Adjust based on your needs
    maxInstances: 1,
  },
  async (event: ScheduledEvent) => {
    console.log("generateWeeklySummaries", event);
    const lastWeek = Timestamp.fromDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));

    try {
      // Get all users from Firebase Auth using the auth instance
      const listUsersResult = await auth.listUsers();
      const users = listUsersResult.users;

      console.log(`Starting weekly analysis for ${users.length} users`);

      for (const user of users) {
        try {
          await generateUserWeeklySummary(user.uid, lastWeek);
          console.log(`Completed analysis for user ${user.uid}`);
        } catch (error) {
          console.error(`Error processing user ${user.uid}:`, error);
        }
      }

      console.log("Weekly analysis completed");
    } catch (error) {
      console.error("Error fetching users:", error);
    }
  }
);

export const onMealRecordRetry = onDocumentUpdated("/meal_records/{recordId}", async (event) => {
  const recordId = event.params.recordId;

  if (!event.data) {
    console.log("No event data available");
    return;
  }

  const beforeData = event.data.before.data();
  const afterData = event.data.after.data();

  if (!beforeData || !afterData) {
    console.log("No data associated with the event");
    return;
  }

  // Only proceed if status changed from error to to_be_processed
  if (beforeData.status !== "error" || afterData.status !== "to_be_processed") {
    return;
  }

  console.log(`Retrying processing for record ${recordId}`);

  // Check if necessary data is available
  if (!afterData.filename || !afterData.userID || !afterData.type) {
    console.log("Required data missing in the record");
    return null;
  }

  // Update the status to "processing"
  await event.data.after.ref.update({
    status: "processing",
  });

  try {
    const storage = admin.storage();
    const bucket = storage.bucket();
    const type = afterData.type;
    const filePath = `${afterData.userID}/${type}/${afterData.filename}`;

    const file = bucket.file(filePath);
    const [fileExists] = await file.exists();
    if (!fileExists) {
      console.log("File does not exist:", filePath);
      return null;
    }

    // Download the file to a temporary location to process
    const tempFilePath = path.join(os.tmpdir(), afterData.filename);
    await file.download({ destination: tempFilePath });
    console.log("File downloaded locally to", tempFilePath);

    // Convert file to base64
    const fileBuffer = fs.readFileSync(tempFilePath);
    const base64Encoded = fileBuffer.toString("base64");
    console.log("File converted to Base64");

    // Use AIService to analyze the image
    const aiService = AIService.getInstance();
    const resultJson = await aiService.analyzeMealImage(base64Encoded);

    await event.data.after.ref.update({
      status: "processed",
      nutritional_report: resultJson,
      processed_at: Timestamp.fromDate(new Date()),
    });

    // Clean up: delete the local file to free up space
    fs.unlinkSync(tempFilePath);

    return null;
  } catch (error) {
    console.error("Failed to fetch or process the file:", error);
    await event.data.after.ref.update({
      status: "error",
      error_details: {
        message: error instanceof Error ? error.message : String(error),
        response_preview: error instanceof Error ? error.stack : String(error),
      },
    });
    return null;
  }
});

// Cloud Function to handle new user creation
export const onUserCreated = beforeUserCreated(async (event) => {
  const user = event.data;
  if (!user) {
    console.log("No user data in event");
    return;
  }

  try {
    // Send notification to Kit
    const kitApiKey = process.env.KIT_API_KEY;
    if (kitApiKey) {
      await axios.post(
        "https://api.kit.com/v4/subscribers",
        {
          email_address: user.email,
          first_name: user.displayName?.split(" ")[0] || "",
          state: "active",
          fields: {
            "Last name": user.displayName?.split(" ").slice(1).join(" ") || "",
            Source: "Firebase Auth",
            "User ID": user.uid,
          },
        },
        {
          headers: {
            "X-Kit-Api-Key": kitApiKey,
            "Content-Type": "application/json",
          },
        }
      );
      console.log("Successfully added user to Kit:", user.email);
    }

    // Send notification to Slack
    try {
      const slackService = SlackService.getInstance();
      await slackService.notifyUserCreated(
        user.email || "No email",
        user.uid,
        user.displayName || undefined
      );
      console.log("Successfully sent notification to Slack");
    } catch (error) {
      console.error("Failed to send Slack notification:", error);
    }
  } catch (error) {
    console.error("Error sending notifications:", error);
  }
});

// ---------------------------------------------------------------------------
// Scheduled: reminder notifications
// ---------------------------------------------------------------------------

/**
 * Process daily reminders every 30 minutes.
 * Checks each user's notification settings, timezone, quiet hours, and log history.
 * Sends FCM push if the user hasn't logged today and conditions are met.
 */
export const sendReminders = onSchedule(
  {
    schedule: "*/30 * * * *", // Every 30 minutes
    timeZone: "UTC",
    memory: "256MiB",
    maxInstances: 1,
  },
  async (event: ScheduledEvent) => {
    console.log("sendReminders triggered", event.scheduleTime);
    await processReminders();
  }
);

/**
 * Send re-engagement nudges once daily at 12:00 UTC.
 * Targets free users who haven't logged in ~3 days.
 */
export const sendReengagementNudges = onSchedule(
  {
    schedule: "0 12 * * *", // Every day at noon UTC
    timeZone: "UTC",
    memory: "256MiB",
    maxInstances: 1,
  },
  async (event: ScheduledEvent) => {
    console.log("sendReengagementNudges triggered", event.scheduleTime);
    await processReengagementNudges();
  }
);
