import * as admin from "firebase-admin";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { analyzeDigestion, fetchDigestionRecords } from "./digestion";
import { analyzeNutrition, fetchMealRecords } from "./meal";
import { WeeklySummary } from "./types";
import { analyzeWaterIntake, fetchWaterRecords } from "./water";
import { AIService } from "./services/ai";

export interface UserGoals {
  calories: number;
  water: number;
  macros: {
    proteins: number; // Target in percentage of total calories
    carbs: number; // Target in percentage of total calories
    fats: number; // Target in percentage of total calories
  };
  bristol_score: number;
  updatedAt: Date;
}

export const DEFAULT_GOALS: UserGoals = {
  calories: 2200,
  water: 2000,
  macros: {
    proteins: 30, // Default protein target: 30% of total calories
    carbs: 40, // Default carbs target: 40% of total calories
    fats: 30, // Default fats target: 30% of total calories
  },
  bristol_score: 4,
  updatedAt: new Date(),
};

/**
 * Fetches user goals from Firestore. If no goals exist, creates and returns default goals.
 * @param {string} userId - The ID of the user whose goals to fetch
 * @return {Promise<UserGoals>} The user's goals or default goals if none exist
 */
export async function fetchUserGoals(userId: string): Promise<UserGoals> {
  const db = getFirestore();
  try {
    const docRef = db.collection("user_goals").doc(userId);
    const docSnap = await docRef.get();

    if (docSnap.exists) {
      return docSnap.data() as UserGoals;
    }

    // If no goals exist, create default goals
    await docRef.set(DEFAULT_GOALS);
    return DEFAULT_GOALS;
  } catch (error) {
    console.error("Error fetching user goals:", error);
    throw new Error(
      `Failed to fetch user goals: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Generates a weekly summary for a specific user
 * @param {string} userId - The ID of the user
 * @param {admin.firestore.Timestamp} startDate - The start date for the summary period
 */
export async function generateUserWeeklySummary(userId: string, startDate: Timestamp) {
  const endDate = Timestamp.fromDate(new Date());

  // Fetch user goals and all relevant data
  const [userGoals, waterRecords, mealRecords, digestionRecords] = await Promise.all([
    fetchUserGoals(userId),
    fetchWaterRecords(userId, startDate, endDate),
    fetchMealRecords(userId, startDate, endDate),
    fetchDigestionRecords(userId, startDate, endDate),
  ]);

  // Generate analyses using user goals
  const waterAnalysis = await analyzeWaterIntake(waterRecords, userGoals);
  const nutritionAnalysis = await analyzeNutrition(mealRecords, userGoals);
  const digestionAnalysis = await analyzeDigestion(digestionRecords, userGoals);

  console.log("WATER ANALYSIS:", waterAnalysis);
  console.log("NUTRITION ANALYSIS:", nutritionAnalysis);
  console.log("DIGESTION ANALYSIS:", digestionAnalysis);

  // Get AI service instance
  const aiService = AIService.getInstance();

  // Create weekly summary
  const summary: WeeklySummary = {
    userID: userId,
    weekStartDate: startDate,
    weekEndDate: endDate,
    waterAnalysis,
    nutritionAnalysis,
    digestionAnalysis,
    correlations: await aiService.generateCorrelations(waterRecords, mealRecords, digestionRecords),
    created_at: Timestamp.fromDate(new Date()),
  };

  // Store the summary
  await admin.firestore().collection("weekly_summaries").add(summary);
}
