/* eslint-disable max-len */
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as admin from "firebase-admin";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onObjectFinalized } from "firebase-functions/v2/storage";
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
          created_at: admin.firestore.Timestamp.now(),
          type: type,
        };

        await db.collection(collection).add(digestionRecordData);
        console.log("Digestion record added successfully");
      } else if (type === "meals") {
        // Add meal record
        const mealRecordData = {
          userID: userID,
          filename: filename,
          status: "to_be_processed",
          nutritional_report: null,
          created_at: admin.firestore.Timestamp.now(),
          type: type,
        };

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

    // Fetch the image (assuming the image is stored in Firebase Storage)

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

      // Optionally, you can now store this base64 string in Firestore or pass it to another function
      // ...

      const genAi = new GoogleGenerativeAI("AIzaSyDCR7Ie019T6bR7tSUiASbr8RkMp4pI-jI");
      const model = genAi.getGenerativeModel({ model: "gemini-1.5-flash" });

      // Define your prompt construction logic here
      const foodCategoriesJsonString = JSON.stringify(
        {
          fruits: [],
          vegetables: [],
          grains: [],
          proteins: {
            meats: [],
            poultry: [],
            "fish and seafood": [],
            eggs: [],
            legumes: [],
            "nuts and seeds": [],
          },
          "dairy and non-dairy alternatives": {
            milk: [],
            cheese: [],
            yogurt: [],
            "plant-based milks": [],
          },
          "fats and oils": [],
          "herbs and spices": [],
          sweeteners: [],
          beverages: [],
          "condiments and sauces": [],
          "baking and cooking ingredients": [],
          "snacks and sweets": [],
          "prepared and processed foods": [],
          "whole meals": [],
        },
        null,
        2
      );

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
        2
      );

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

      // Return the constructed prompt

      // Use the base64Image in your generative model
      const image = {
        inlineData: {
          data: base64Encoded,
          mimeType: "image/png", // Adjust the MIME type based on your actual image type
        },
      };

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

    const genAi = new GoogleGenerativeAI("AIzaSyDCR7Ie019T6bR7tSUiASbr8RkMp4pI-jI");
    const model = genAi.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Process based on the source
    if (data.analysis.source === "manual") {
      try {
        const outputFormatDigestion = JSON.stringify(
          {
            analysis: {
              color: "",
              consistency: "",
              shape: "",
              size: "",
              presence_of_blood: false,
              presence_of_mucus: false,
              bristol_stool_scale: 0,
            },
            concerns: [],
            recommendations: [],
            summary: "",
          },
          null,
          2
        );

        const promptDigestion =
          "As an AI medical expert specializing in gastroenterology, analyze the following stool characteristics and provide medical insights: " +
          `Bristol Scale: Type ${data.analysis.bristol_scale}\n` +
          `Color: ${data.analysis.color}\n` +
          `Consistency: ${data.analysis.consistency}\n` +
          `Shape: ${data.analysis.shape}\n` +
          `Size: ${data.analysis.size}\n` +
          `Presence of Blood: ${data.analysis.has_blood}\n` +
          `Presence of Mucus: ${data.analysis.has_mucus}\n\n` +
          "Based on these characteristics:\n" +
          "1. Clinical Assessment: Evaluate the stool characteristics for any potential health implications.\n" +
          "2. Medical Concerns: List any potential health concerns based on the provided characteristics.\n" +
          "3. Recommendations: Provide relevant medical recommendations based on the analysis.\n" +
          "Output: Respond ONLY with a JSON object that matches exactly the following template, without any additional text or explanations: " +
          outputFormatDigestion +
          " Ensure all responses are clinical and professional in nature. The analysis should focus on providing actionable medical insights while maintaining medical accuracy and professionalism.";

        // Generate content using the model
        const result = await model.generateContent([promptDigestion]);
        const responseText = result.response.text();

        // Extract the JSON part from the markdown response
        const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/);
        if (!jsonMatch) {
          throw new Error("Could not find JSON content in response");
        }

        const jsonContent = jsonMatch[1];
        const resultJson = JSON.parse(jsonContent);

        // Update record with AI insights
        await docRef.update({
          status: "processed",
          processed_at: admin.firestore.Timestamp.now(),
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

        const outputFormatDigestion = JSON.stringify(
          {
            analysis: {
              color: "",
              consistency: "",
              shape: "",
              size: "",
              presence_of_blood: false,
              presence_of_mucus: false,
              bristol_stool_scale: 0,
            },
            concerns: [],
            recommendations: [],
            summary: "",
          },
          null,
          2
        );

        const promptDigestion =
          "As an AI medical expert specializing in gastroenterology, analyze the provided image of a bowel movement. " +
          "Perform the following analysis with clinical precision: " +
          "1. Visual Assessment: Evaluate the stool's physical characteristics including color, consistency, shape, and size. " +
          "2. Clinical Indicators: Identify any concerning elements such as the presence of blood, mucus, or abnormal coloration. " +
          "3. Bristol Stool Scale Classification: Determine the type according to the Bristol Stool Form Scale (1-7). " +
          "4. Medical Concerns: List any potential health concerns based on the visual analysis. " +
          "5. Recommendations: Provide relevant medical recommendations if concerns are identified. " +
          "Output: Respond ONLY with a JSON object that matches exactly the following template, without any additional text or explanations: " +
          outputFormatDigestion;

        const image = {
          inlineData: {
            data: base64Encoded,
            mimeType: "image/png",
          },
        };

        const result = await model.generateContent([promptDigestion, image]);
        const responseText = result.response.text();

        const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/);
        if (!jsonMatch) {
          throw new Error("Could not find JSON content in response");
        }

        const jsonContent = jsonMatch[1];
        const resultJson = JSON.parse(jsonContent);

        // Update with new structure
        await docRef.update({
          status: "processed",
          processed_at: admin.firestore.Timestamp.now(),
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
