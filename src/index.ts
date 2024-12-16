/* eslint-disable max-len */
import {GoogleGenerativeAI} from "@google/generative-ai";
import * as admin from "firebase-admin";
import {onDocumentCreated, onDocumentUpdated} from "firebase-functions/v2/firestore";
import {onObjectFinalized} from "firebase-functions/v2/storage";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Initialize Firebase Admin SDK
admin.initializeApp();

// Firestore reference
const db = admin.firestore();

// Start writing functions
// https://firebase.google.com/docs/functions/typescript


// Cloud Function to handle object finalization in Firebase Storage
export const fileCreated =
  onObjectFinalized({bucket: "nutrisnap-96caf.appspot.com"},
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
          // TODO: nothing to do here ??
        } else if (type === "meals") {
          // Add meal record
          const mealRecordData = {
            userID: userID,
            filename: filename,
            status: "to_be_processed",
            nutritional_report: null,
            uploaded_at: admin.firestore.Timestamp.now(),
            type: type,
          };

          await db.collection(collection).add(mealRecordData);
        } else if (type === "profile") {
          // TODO: Add profile record
        }

        // console.log(`${type} successfully written with ID:`, docRef.id);
      } catch (error) {
        console.error("Error writing document:", error);
      }
    });

export const onImageProcessingRecordCreated =
  onDocumentCreated("/meal_records/{recordId}", async (event) => {
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

    // Fetch the image (assuming the image is stored in Firebase Storage)
    const storage = admin.storage();
    const bucket = storage.bucket("nutrisnap-96caf.appspot.com");
    const type = newData.type;
    const filePath = `${newData.userID}/${type}/${newData.filename}`;

    try {
      const file = bucket.file(filePath);
      const [fileExists] = await file.exists();
      if (!fileExists) {
        console.log("File does not exist:", filePath);
        return null;
      }


      // Download the file to a temporary location to process
      const tempFilePath = path.join(os.tmpdir(), newData.filename);
      await file.download({destination: tempFilePath});
      console.log("File downloaded locally to", tempFilePath);

      // Convert file to base64
      const fileBuffer = fs.readFileSync(tempFilePath);
      const base64Encoded = fileBuffer.toString("base64");
      console.log("File converted to Base64");

      // Optionally, you can now store this base64 string in Firestore or pass it to another function
      // ...

      const genAi = new GoogleGenerativeAI("AIzaSyDCR7Ie019T6bR7tSUiASbr8RkMp4pI-jI");
      const model = genAi.getGenerativeModel({model: "gemini-1.5-flash"});

      // Define your prompt construction logic here
      const foodCategoriesJsonString = JSON.stringify(
        {
          "fruits": [],
          "vegetables": [],
          "grains": [],
          "proteins": {
            "meats": [],
            "poultry": [],
            "fish and seafood": [],
            "eggs": [],
            "legumes": [],
            "nuts and seeds": [],
          },
          "dairy and non-dairy alternatives": {
            "milk": [],
            "cheese": [],
            "yogurt": [],
            "plant-based milks": [],
          },
          "fats and oils": [],
          "herbs and spices": [],
          "sweeteners": [],
          "beverages": [],
          "condiments and sauces": [],
          "baking and cooking ingredients": [],
          "snacks and sweets": [],
          "prepared and processed foods": [],
          "whole meals": [],
        },
        null,
        2,
      );

      console.log("foodCategoriesJsonString", foodCategoriesJsonString);

      const outputFormat = JSON.stringify(
        {
          image_recognition: {
            name: "",
          },
          ingredient_extraction: [],
          ingredient_categorization: {},
          nutritional_information: {
            calories: "",
            macronutrients: {
              carbohydrates: "",
              proteins: "",
              fats: "",
            },
            micronutrients: {
              vitamins: {
                vitaminC: "",
                vitaminA: "",
              },
              minerals: {
                potassium: "",
                magnesium: "",
              },
            },
          },
          caloric_breakdown: {
            carbohydrates: "",
            proteins: "",
            fats: "",
          },
          description: "",
        },
        null,
        2,
      );

      console.log("outputFormat", outputFormat);

      const prompt =
        "Given an image provided, assume that you are working for an app and do the following: " +
        "Image Recognition: Utilize advanced image recognition technology to analyze user-uploaded food images. The system should be capable of identifying the dish presented in the image with high accuracy. " +
        "Ingredient Extraction: Once the dish is identified, deploy a food recognition algorithm to dissect the image and determine the individual ingredients that make up the dish. The algorithm should be trained on a comprehensive dataset of food images and their corresponding ingredients to ensure broad coverage of various cuisines and dish types. " +
        "Ingredient Categorization: Organize the extracted ingredients into standard food categories. " +
        "These categories may include, but are not limited to, the following: " +
        foodCategoriesJsonString +
        "Nutritional Information: Provide numerical values only for nutritional information. All measurements should be in grams (g) for macronutrients, milligrams (mg) for micronutrients, and absolute numbers for calories. Do not include text descriptions, ranges, or approximations - use single numerical values even if estimated. " +
        "Caloric Breakdown: Calculate specific numerical values for the caloric content. Provide exact numbers for the breakdown of calories by macronutrient (carbohydrates, proteins, fats), avoiding any text descriptions or ranges. " +
        "Description: Generate a tentative name for the dish and a brief description based on the identified ingredients. " +
        "Output: Respond ONLY with a JSON object that matches exactly the following template, without any additional text, notes, or explanations. All nutritional values must be numbers, not strings or text descriptions: " +
        outputFormat +
        " The ultimate goal is to provide users with an informative and engaging experience that helps them understand the composition of their meals and encourages informed dietary choices. Remember to provide ONLY the JSON response without any additional commentary or markdown formatting, and ensure all nutritional values are numerical.";


      console.log("prompt", prompt);

      // Return the constructed prompt

      // Use the base64Image in your generative model
      const image = {
        inlineData: {
          data: base64Encoded,
          mimeType: "image/png", // Adjust the MIME type based on your actual image type
        },
      };

      console.log("image", image);

      // Generate content using the model
      const result = await model.generateContent([prompt, image]);

      // Log the entire result object
      console.log("Complete result object:", JSON.stringify(result, null, 2));

      // Get the raw response text
      const responseText = result.response.text();
      console.log("Raw response text:", responseText);

      try {
        // Extract the JSON part from the markdown response
        const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/);

        if (!jsonMatch) {
          throw new Error("Could not find JSON content in response");
        }

        const jsonContent = jsonMatch[1];
        console.log("Extracted JSON content:", jsonContent);

        const resultJson = JSON.parse(jsonContent);
        console.log("Successfully parsed JSON:", resultJson);

        await snapshot.ref.update({
          status: "processed",
          nutritional_report: resultJson,
          processed_at: admin.firestore.Timestamp.now(),
        });
      } catch (error: unknown) {
        if (error instanceof Error) {
          console.error("JSON Parse Error:", error.message);
        } else {
          console.error("JSON Parse Error:", String(error));
        }

        // Log the first few characters to see what's causing the issue
        console.error("First 100 characters of response:", responseText.substring(0, 100));

        await snapshot.ref.update({
          status: "error",
          error_details: {
            message: error instanceof Error ? error.message : String(error),
            response_preview: responseText.substring(0, 100),
          },
        });
        throw error;
      }

      // Clean up: delete the local file to free up space
      fs.unlinkSync(tempFilePath);

      return null;
    } catch (error) {
      console.error("Failed to fetch or process the file:", error);
      await snapshot.ref.update({
        status: "error",
      });
      return null;
    }
  });

// New function to handle digestion record processing
export const onDigestionRecordUpdated = onDocumentUpdated(
  "/digestion_records/{recordId}",
  async (event) => {
    console.log("onDigestionRecordUpdated", event);

    const data = event.data;

    if (!data) {
      console.log("No data associated with the event");
      return;
    }

    const beforeData = data.before.data();
    const afterData = data.after.data();
    const docRef = data.after.ref; // Get the document reference

    console.log("beforeData", beforeData);
    console.log("afterData", afterData);

    if (!beforeData || !afterData) {
      console.log("No data associated with the event");
      return;
    }

    // Only process if status changed to "processing"
    if (beforeData.status !== "processing" && afterData.status === "processing") {
      console.log(`Processing digestion record ${event.params.recordId}`);

      try {
        // Process image and update record
        // const storage = admin.storage();
        // const bucket = storage.bucket("nutrisnap-96caf.appspot.com");
        // const filePath = `${afterData.user_id}/digestions/${afterData.filename}`;

        // ... image processing logic ...

        const analysisResult = {
          concerns: [
            // AI analysis results
            "This is a test",
          ],
          recommendations: [
            // AI recommendations
            "This is a test",
          ],
        };

        // Use docRef instead of afterData
        await docRef.update({
          status: "processed",
          ai_analysis: analysisResult,
          processed_at: admin.firestore.Timestamp.now(),
        });
      } catch (error) {
        console.error("Failed to process digestion record:", error);
        // Use docRef instead of afterData
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
