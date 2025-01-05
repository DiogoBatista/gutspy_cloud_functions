/* eslint-disable max-len */
import * as admin from "firebase-admin";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule, ScheduledEvent } from "firebase-functions/v2/scheduler";
import { onObjectFinalized } from "firebase-functions/v2/storage";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { AIService } from "./services/ai";
import { generateUserWeeklySummary } from "./user";

admin.initializeApp({
  projectId: "nutrisnap-96caf",
});

// Get service instances
const db = getFirestore();
const auth = getAuth();

// Debug logging
// console.log("Firebase Admin initialized with config:", admin.app().options);
// console.log("Firestore instance:", db);

// Start writing functions
// https://firebase.google.com/docs/functions/typescript

// Cloud Function to handle object finalization in Firebase Storage
export const fileCreated = onObjectFinalized(
  { bucket: "nutrisnap-96caf.appspot.com" },
  async (event) => {
    // Extract the file path and name
    const filePath = event.data.name; // File path in the bucket
    if (!filePath) return console.log("No file path found");

    // Split the filePath to get userID, type and filename
    const pathSegments = filePath.split("/");
    if (pathSegments.length < 3) {
      return console.log("Unexpected file path structure:", filePath);
    }

    // Structure is "userID/type/filename"
    const userID = pathSegments[0];
    const type = pathSegments[1];
    const filename = pathSegments[2];

    console.log("userID", userID);
    console.log("type", type);
    console.log("filename", filename);

    // Validate type
    if (!["meals", "digestions", "profile"].includes(type)) {
      return console.log("Invalid type:", type);
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
  }
);

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
      const bucket = storage.bucket("nutrisnap-96caf.appspot.com");
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

    const aiService = AIService.getInstance();

    // Process based on the source
    if (data.analysis.source === "manual") {
      try {
        const resultJson = await aiService.analyzeDigestionData(data.analysis);

        // Update record with AI insights
        await docRef.update({
          status: "processed",
          processed_at: Timestamp.fromDate(new Date()),
          // Keep the original analysis data but add AI recommendations
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
    } else if (data.filename) {
      // Process AI image analysis
      try {
        const storage = admin.storage();
        const bucket = storage.bucket("nutrisnap-96caf.appspot.com");
        const filePath = `${data.userID}/digestions/${data.filename}`;

        const file = bucket.file(filePath);
        const [fileExists] = await file.exists();

        if (!fileExists) {
          await docRef.update({
            status: "failed",
            error_details: {
              message: "File does not exist",
            },
          });
          return null;
        }

        // update the status to processing
        await docRef.update({
          status: "processing",
        });

        // Download and process image
        const tempFilePath = path.join(os.tmpdir(), data.filename);
        await file.download({ destination: tempFilePath });
        const fileBuffer = fs.readFileSync(tempFilePath);
        const base64Encoded = fileBuffer.toString("base64");

        const resultJson = await aiService.analyzeDigestionImage(base64Encoded);

        // Update with new structure
        await docRef.update({
          status: "processed",
          processed_at: Timestamp.fromDate(new Date()),
          analysis: {
            ...data.analysis,
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

        // Clean up temp file
        fs.unlinkSync(tempFilePath);
      } catch (error) {
        console.error("Failed to process AI record:", error);
        await docRef.update({
          status: "failed",
          error_details: {
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }

    return null;
  }
);

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
      console.log("AUTH:", { auth });

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
